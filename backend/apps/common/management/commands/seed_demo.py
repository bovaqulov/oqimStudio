"""Fills an empty database with the same demo workspace the interface ships.

The frontend's in-memory repositories seed "Sunrise Agency" with one project,
one bot and a handful of flows; this command builds the same thing in Postgres
or SQLite, with the same ids, so pointing the interface at this backend shows
the screens it already shows — same names, same handles, same login.

Idempotent: run it twice and nothing doubles. `--reset` wipes the demo tenant
first, for when the shape of the seed itself has changed.
"""

from __future__ import annotations

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.analytics.models import Event, Metric
from apps.billing.models import Invoice, Plan, Subscription
from apps.bots.models import Bot, BotActivity
from apps.contacts.models import Contact
from apps.flows.models import Flow
from apps.flows.services import ensure_main_flow, reindex_triggers
from apps.inbox.models import Message
from apps.marketplace.models import MarketTemplate, TemplateReview
from apps.notifications.models import Notification
from apps.projects.models import Project, ProjectActivity
from apps.workspaces.models import Membership, Role, Workspace

WORKSPACE_ID = "sunrise-agency"
PROJECT_ID = "sunrise-academy"
BOT_ID = "sunrise-academy-bot"
DEMO_PASSWORD = "Parol12345"


class Command(BaseCommand):
    help = "Namuna ma'lumotlarini yaratadi (Sunrise Agency ish maydoni)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Avval namuna ish maydonini o'chiradi")
        parser.add_argument("--days", type=int, default=21, help="Necha kunlik analitika hodisasi yozilsin")

    @transaction.atomic
    def handle(self, *args, **options):
        from django.contrib.auth import get_user_model

        User = get_user_model()

        if options["reset"]:
            Workspace.objects.filter(pk__in=[WORKSPACE_ID, "yangi-ish-maydoni"]).delete()
            self.stdout.write("Namuna ish maydoni o'chirildi")

        aziza = self._user(User, "aziza@sunrise.uz", "Aziza Sultonova")
        jasur = self._user(User, "jasur@sunrise.uz", "Jasur Ismoilov")

        workspace = self._workspace(aziza)
        self._members(workspace, aziza, jasur)
        self._second_workspace(aziza)
        plan = self._billing(workspace)
        project = self._project(workspace, aziza)
        bot = self._bot(workspace, project, aziza)
        flows = self._flows(workspace, project, bot)
        contacts = self._contacts(workspace, bot)
        self._conversations(workspace, bot, contacts)
        self._events(workspace, bot, flows, contacts, options["days"])
        self._notifications(workspace)
        self._templates(workspace)

        self.stdout.write(
            self.style.SUCCESS(
                f"Tayyor. Kirish: aziza@sunrise.uz / {DEMO_PASSWORD} · "
                f"ish maydoni {workspace.id} · tarif {plan.key}"
            )
        )

    # -- pieces ------------------------------------------------------------

    def _user(self, User, email: str, name: str):
        user = User.objects.filter(email=email).first()
        if user is None:
            user = User.objects.create_user(email=email, password=DEMO_PASSWORD, name=name, email_verified=True)
        return user

    def _workspace(self, owner) -> Workspace:
        workspace, _ = Workspace.objects.update_or_create(
            id=WORKSPACE_ID,
            defaults={
                "name": "Sunrise Agency",
                "slug": WORKSPACE_ID,
                "plan_key": "pro",
                "timezone": "Asia/Tashkent",
                "locale": "uz-UZ",
                "currency": "UZS",
                "owner": owner,
                # Everything in here is made up. The panel says so on every
                # screen that shows a number.
                "is_demo": True,
            },
        )
        return workspace

    def _second_workspace(self, owner) -> None:
        """A second, empty tenant: the workspace switcher is only honest when
        there is something to switch to.

        Created after the demo one on purpose — a request that names no
        workspace acts on the caller's oldest membership, and someone opening
        the demo expects to land in Sunrise Agency.
        """
        Workspace.objects.update_or_create(
            id="yangi-ish-maydoni",
            defaults={"name": "Yangi ish maydoni", "slug": "yangi-ish-maydoni", "owner": owner},
        )
        Membership.objects.update_or_create(
            workspace_id="yangi-ish-maydoni",
            email=owner.email,
            defaults={"user": owner, "name": owner.name, "role": Role.OWNER},
        )

    def _members(self, workspace: Workspace, owner, editor) -> None:
        Membership.objects.update_or_create(
            workspace=workspace,
            email=owner.email,
            defaults={"user": owner, "name": owner.name, "role": Role.OWNER},
        )
        Membership.objects.update_or_create(
            workspace=workspace,
            email=editor.email,
            defaults={"user": editor, "name": editor.name, "role": Role.EDITOR},
        )

    def _billing(self, workspace: Workspace) -> Plan:
        # `aiBlocks` is spelled out on every row on purpose. These limits are
        # written wholesale, so a key left out here is a key the plan does not
        # declare — and an undeclared limit is uncapped. Leaving it out gave the
        # free plan unlimited AI blocks, quietly undoing migration 0002, which
        # exists to set exactly this: 0 on the entry plan, uncapped above it.
        #
        # The entry plan reads "Free" while its *key* stays `start`: the key is
        # what `workspace.plan_key` and every subscription row point at, and a
        # renamed key would strand each of them on a plan that no longer exists.
        # The name is the only part a customer was ever shown.
        #
        # Biznes is kept but not public — the price list is Free / Pro for now,
        # and deleting the row would break the workspaces already sitting on it.
        plans = [
            ("start", "Free", 0,
             {"bots": 1, "flows": 5, "messages": 5000, "contacts": 1000, "members": 2, "aiBlocks": 0}, 0, True),
            ("pro", "Pro", 490000,
             {"bots": 5, "flows": 50, "messages": 100000, "contacts": 20000, "members": 10, "aiBlocks": None}, 1, True),
            ("biznes", "Biznes", 1490000,
             {"bots": None, "flows": None, "messages": None, "contacts": None, "members": None, "aiBlocks": None}, 2, False),
        ]
        for key, name, price, limits, order, is_public in plans:
            Plan.objects.update_or_create(
                key=key,
                defaults={
                    "name": name,
                    "description": f"{name} tarifi",
                    "price": Decimal(price),
                    "currency": "UZS",
                    "limits": limits,
                    "order": order,
                    "is_public": is_public,
                },
            )
        plan = Plan.objects.get(pk="pro")
        Subscription.objects.update_or_create(
            workspace=workspace,
            defaults={
                "plan": plan,
                "status": "Faol",
                "renews_at": (timezone.now() + timedelta(days=21)).date(),
                "auto_renew": True,
                "payment_method": {"label": "Uzcard •••• 4242", "expiry": "09/28"},
            },
        )
        for offset in range(3):
            date = (timezone.now() - timedelta(days=30 * offset)).date()
            Invoice.objects.update_or_create(
                workspace=workspace,
                number=f"INV-{date:%Y%m}",
                defaults={"date": date, "amount": plan.price, "currency": "UZS", "status": "To'langan"},
            )
        return plan

    def _project(self, workspace: Workspace, owner) -> Project:
        project, _ = Project.objects.update_or_create(
            id=PROJECT_ID,
            defaults={
                "workspace": workspace,
                "name": "Sunrise Academy",
                "handle": "sunrise-academy",
                "icon": "graduation-cap",
                "tag": "Ta'lim",
                "description": "Ingliz tili kurslari uchun bot va oqimlar",
                "created_by": owner,
            },
        )
        if not project.activity.exists():
            for subject, text, icon in [
                ("Aziza", "Loyiha yaratildi", "folder"),
                ("Aziza", "Sunrise Academy bot ulandi", "robot"),
                ("Jasur", "Ochiq darsga yozilish oqimi nashr qilindi", "flow-arrow"),
            ]:
                ProjectActivity.objects.create(project=project, subject=subject, text=text, icon=icon)
        return project

    def _bot(self, workspace: Workspace, project: Project, owner) -> Bot:
        bot, _ = Bot.objects.update_or_create(
            id=BOT_ID,
            defaults={
                "workspace": workspace,
                "project": project,
                "handle": "@sunrise_academy_bot",
                "kind": Bot.Kind.BOT,
                "status": "Faol",
                # A made-up token: the seed never calls Telegram, and
                # TELEGRAM_OFFLINE=1 keeps it that way when the runtime runs.
                "token": "7842119503:AAF718264444xQe-demo-token",
                "telegram_id": 7842119503,
                "username": "sunrise_academy_bot",
                "connected_by": owner,
                "connected_at": timezone.now() - timedelta(days=60),
                "enabled_modules": ["dms", "business"],
                "webhook_url": "",
            },
        )
        if not bot.activity.exists():
            for text, icon in [
                ("Bot loyihaga qo'shildi", "robot"),
                ("Webhook ulandi", "plugs-connected"),
                ("Business bo'limi yoqildi", "user-circle"),
            ]:
                BotActivity.objects.create(bot=bot, text=text, icon=icon)
        return bot

    def _flows(self, workspace: Workspace, project: Project, bot: Bot) -> list[Flow]:
        main = ensure_main_flow(workspace=workspace, project=project, bot=bot)

        welcome, created = Flow.objects.get_or_create(
            id="dms-welcome-chain",
            defaults={
                "workspace": workspace,
                "project": project,
                "bot": bot,
                "module_key": "dms",
                "name": "Xush kelibsiz zanjiri",
                "description": "Kalit so'zga javoban tanishtiruv va operator taklifi",
                "status": "Faol",
                "status_tone": "success",
                "enabled": True,
                "runs": 864,
                "origin": {"kind": "wizard", "label": "Yordamchi · Kalit so'z"},
                "nodes": [
                    {
                        "id": "t1",
                        "type": "trigger",
                        "x": 120,
                        "y": 60,
                        "title": "Kalit so'z",
                        "text": "narx / kurs",
                        "channel": "tg",
                        "scopes": [],
                        "dmsTrigger": {"kinds": ["keyword"], "keywords": "narx\nkurs", "keywordMatch": "contains"},
                    },
                    {
                        "id": "m1",
                        "type": "message",
                        "x": 120,
                        "y": 200,
                        "title": "Narxlar",
                        "text": "Salom {{mijoz_ismi}}! Kurslar narxi oyiga 690 000 so'm.",
                        "channel": "tg",
                        "scopes": [],
                        "contentKind": "text",
                    },
                    {
                        "id": "m2",
                        "type": "message",
                        "x": 120,
                        "y": 340,
                        "title": "Administrator",
                        "text": "Batafsil ma'lumot uchun administrator tez orada bog'lanadi.",
                        "channel": "tg",
                        "scopes": [],
                        "contentKind": "text",
                    },
                ],
                "edges": [
                    {"id": "e1", "from": "t1", "port": "out", "to": "m1"},
                    {"id": "e2", "from": "m1", "port": "out", "to": "m2"},
                ],
            },
        )
        if created:
            reindex_triggers(welcome)

        after_hours, created = Flow.objects.get_or_create(
            id="business-after-hours",
            defaults={
                "workspace": workspace,
                "project": project,
                "bot": bot,
                "module_key": "business",
                "name": "Ish vaqtidan tashqari avtojavob",
                "description": "Soat 18:00 dan keyin kelgan xabarlarga javob beradi",
                "status": "Faol",
                "status_tone": "success",
                "enabled": True,
                "runs": 212,
                "origin": {"kind": "template", "key": "after-hours", "label": "Shablon · Ish vaqtidan tashqari"},
                "nodes": [
                    {
                        "id": "b1",
                        "type": "trigger",
                        "x": 120,
                        "y": 60,
                        "title": "Business xabar",
                        "text": "Ish vaqtidan tashqari",
                        "channel": "tg",
                        "scopes": [],
                        "business": {
                            "messageTypes": ["new"],
                            "match": "any",
                            "schedule": {
                                "mode": "outside",
                                "days": [1, 2, 3, 4, 5],
                                "from": "09:00",
                                "to": "18:00",
                                "timezone": "Asia/Tashkent",
                            },
                        },
                    },
                    {
                        "id": "b2",
                        "type": "message",
                        "x": 120,
                        "y": 200,
                        "title": "Avtojavob",
                        "text": "Hozir ish vaqtimiz tugagan. Ertalab albatta javob beramiz.",
                        "channel": "tg",
                        "scopes": [],
                        "contentKind": "text",
                    },
                ],
                "edges": [{"id": "e1", "from": "b1", "port": "out", "to": "b2"}],
            },
        )
        if created:
            reindex_triggers(after_hours)

        return [main, welcome, after_hours]

    def _contacts(self, workspace: Workspace, bot: Bot) -> list[Contact]:
        people = [
            (100001, "Dilnoza", "Karimova", "dilnoza", "ads"),
            (100002, "Sardor", "Aliyev", "sardor_a", "organic"),
            (100003, "Malika", "Tursunova", "malika", "campaign"),
            (100004, "Bekzod", "Rahimov", "bekzod", "referral"),
        ]
        contacts = []
        for telegram_id, first, last, username, source in people:
            contact, _ = Contact.objects.update_or_create(
                bot=bot,
                telegram_user_id=telegram_id,
                defaults={
                    "workspace": workspace,
                    "chat_id": telegram_id,
                    "first_name": first,
                    "last_name": last,
                    "username": username,
                    "source": source,
                    "language_code": "uz",
                },
            )
            contacts.append(contact)
        return contacts

    def _conversations(self, workspace: Workspace, bot: Bot, contacts: list[Contact]) -> None:
        """A few threads, so Suhbatlar has something to open.

        Written straight to `inbox.Message` rather than driven through the
        runtime: `dispatch` would need a real update per line and, off offline
        mode, a real Bot API call per answer. What the screen is being given is
        the shape of a conversation — a question, an answer, and one that nobody
        has answered yet, which is the row an operator is looking for.
        """
        if Message.objects.filter(workspace=workspace).exists():
            return

        threads = [
            [
                ("in", "Assalomu alaykum, kurslar narxi qancha?"),
                ("out", "Assalomu alaykum! IT kurslari 690 000 so'mdan boshlanadi."),
                ("in", "Rahmat, o'ylab ko'raman"),
            ],
            [
                ("in", "/start"),
                ("out", "Salom! Qaysi kurs qiziqtiradi?"),
                ("in", "Ingliz tili, kechqurun guruhi bormi?"),
            ],
            [("in", "Dars jadvalini yuborasizmi?")],
        ]
        now = timezone.now()
        for index, (contact, thread) in enumerate(zip(contacts, threads)):
            for step, (direction, text) in enumerate(thread):
                Message.objects.create(
                    workspace=workspace,
                    bot=bot,
                    contact=contact,
                    direction=direction,
                    kind="text" if direction == "out" else "message",
                    text=text,
                    created_at=now - timedelta(hours=index * 5, minutes=(len(thread) - step) * 7),
                )

    def _events(self, workspace, bot, flows, contacts, days: int) -> None:
        """A plausible history, so the analytics screen has something to draw."""
        if Event.objects.filter(workspace=workspace).exists():
            return

        rng = random.Random(20260819)
        today = timezone.now().date()
        rows = []
        for offset in range(days):
            day = today - timedelta(days=offset)
            # Weekends are quieter — a flat line reads as fake data, and every
            # chart in the product is being judged on this seed.
            weight = 0.55 if day.isoweekday() in (6, 7) else 1.0
            for flow in flows:
                conversations = int(rng.randint(8, 40) * weight)
                contact = rng.choice(contacts)
                counts = {
                    Metric.CONVERSATION: conversations,
                    Metric.NEW_CONTACT: int(conversations * rng.uniform(0.2, 0.5)),
                    Metric.MESSAGE: int(conversations * rng.uniform(1.5, 3.0)),
                    Metric.CLICK: int(conversations * rng.uniform(0.3, 0.9)),
                    Metric.HANDOFF: int(conversations * rng.uniform(0.0, 0.15)),
                    Metric.CONVERSION: int(conversations * rng.uniform(0.05, 0.2)),
                }
                for metric, count in counts.items():
                    for _ in range(count):
                        rows.append(
                            Event(
                                workspace=workspace,
                                project_id=flow.project_id,
                                bot_id=bot.id,
                                flow_id=flow.id,
                                contact_id=contact.id,
                                module_key=flow.module_key,
                                source=contact.source,
                                metric=metric,
                                value=Decimal(1),
                                occurred_at=timezone.now() - timedelta(days=offset),
                                occurred_on=day,
                            )
                        )
                revenue = counts[Metric.CONVERSION] * rng.choice([490000, 690000])
                if revenue:
                    rows.append(
                        Event(
                            workspace=workspace,
                            project_id=flow.project_id,
                            bot_id=bot.id,
                            flow_id=flow.id,
                            module_key=flow.module_key,
                            source=contacts[0].source,
                            metric=Metric.REVENUE,
                            value=Decimal(revenue),
                            currency="UZS",
                            occurred_at=timezone.now() - timedelta(days=offset),
                            occurred_on=day,
                        )
                    )
        Event.objects.bulk_create(rows, batch_size=1000)

    def _notifications(self, workspace) -> None:
        if Notification.objects.filter(workspace=workspace).exists():
            return
        Notification.objects.create(
            workspace=workspace,
            kind=Notification.Kind.HANDOFF,
            title="Operator kerak",
            text="Dilnoza Karimova · Xush kelibsiz zanjiri",
            icon="headset",
            href=f"/bots/{BOT_ID}/modules/business",
        )
        Notification.objects.create(
            workspace=workspace,
            kind=Notification.Kind.BILLING,
            title="Tarif 21 kundan keyin yangilanadi",
            text="Pro · 490 000 so'm",
            icon="credit-card",
            href="/billing",
        )

    def _templates(self, workspace: Workspace) -> None:
        # `is_demo` on every one of them: the install counts and the review
        # below are invented, and the market is the one screen where those
        # numbers are the whole basis for choosing. The badge the panel draws
        # from it is what keeps «O'rnatishlar 1 240» from reading as fact.
        templates = [
            {
                "id": "keyword-dm-funnel",
                "name": "Kalit so'z → DM voronkasi",
                "description": "Kalit so'zga javoban shaxsiy xabar va tanishuv zanjiri",
                "category": MarketTemplate.Category.SALES,
                "author": "Oqim Studio",
                "module_key": "dms",
                "installs": 1240,
                "requires": ["Bot ichida"],
                "is_demo": True,
            },
            {
                "id": "after-hours-autoreply",
                "name": "Ish vaqtidan tashqari avtojavob",
                "description": "Ish vaqti tugagach mijozga javob qaytaradi",
                "category": MarketTemplate.Category.SUPPORT,
                "author": "Oqim Studio",
                "module_key": "business",
                "installs": 860,
                "requires": ["Business"],
                "is_demo": True,
            },
        ]
        for data in templates:
            template, created = MarketTemplate.objects.update_or_create(
                id=data.pop("id"),
                defaults={
                    **data,
                    "preview": [
                        {"icon": "flow-arrow", "title": "Handler", "detail": "Oqim qachon ishga tushadi"},
                        {"icon": "chat-circle", "title": "Xabar", "detail": "Birinchi javob"},
                    ],
                    "nodes": [
                        {
                            "id": "t1",
                            "type": "trigger",
                            "x": 120,
                            "y": 60,
                            "title": "Handler",
                            "text": "Ishga tushish sharti",
                            "channel": "tg",
                            "scopes": [],
                            "dmsTrigger": {"kinds": ["keyword"], "keywords": "narx", "keywordMatch": "contains"},
                        },
                        {
                            "id": "m1",
                            "type": "message",
                            "x": 120,
                            "y": 200,
                            "title": "Javob",
                            "text": "Rahmat! Tez orada bog'lanamiz.",
                            "channel": "tg",
                            "scopes": [],
                            "contentKind": "text",
                        },
                    ],
                    "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
                },
            )
            if created:
                TemplateReview.objects.create(
                    template=template, author_name="Jasur Ismoilov", rating=5, text="Bir bosishda ishladi."
                )

        # One the workspace published itself, so "Mening shablonlarim" has
        # something to show — an empty screen says nothing about what it is for.
        MarketTemplate.objects.update_or_create(
            id="sunrise-course-funnel",
            defaults={
                "name": "Kurs voronkasi",
                "icon": "graduation-cap",
                "description": "Ochiq dars → sinov darsi → to'lov havolasi",
                "category": MarketTemplate.Category.SALES,
                "author": "Sunrise Agency",
                "module_key": "dms",
                "installs": 14,
                "requires": ["Bot ichida"],
                "is_demo": True,
                "owner_workspace": workspace,
                "preview": [{"icon": "flow-arrow", "title": "Handler", "detail": "Kalit so'z bilan ishga tushadi"}],
                "nodes": [
                    {
                        "id": "t1",
                        "type": "trigger",
                        "x": 120,
                        "y": 60,
                        "title": "Kalit so'z",
                        "text": "kurs",
                        "channel": "tg",
                        "scopes": [],
                        "dmsTrigger": {"kinds": ["keyword"], "keywords": "kurs", "keywordMatch": "contains"},
                    },
                    {
                        "id": "m1",
                        "type": "message",
                        "x": 120,
                        "y": 200,
                        "title": "Ochiq dars",
                        "text": "Ochiq darsga yozilasizmi?",
                        "channel": "tg",
                        "scopes": [],
                        "contentKind": "text",
                    },
                ],
                "edges": [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
            },
        )
