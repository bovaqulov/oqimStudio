"""Removes the seeded demo tenant's content, leaving real records untouched.

The inverse of `seed_demo`, and deliberately not a `Workspace.delete()`: by the
time anybody wants the demo gone they have already connected a real bot inside
the demo workspace, and dropping the tenant would take their bot, their flow
and their contacts with it.

So this deletes what the seed created, by the ids the seed created it under —
the demo project and everything under it, the invented analytics history, the
fake subscription — and then clears `is_demo`, because a workspace that holds
only real records must stop telling its owner that its numbers are made up.

Idempotent, and safe to run on a database that was never seeded.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from apps.analytics.models import Event
from apps.billing.models import Invoice, Subscription
from apps.bots.models import Bot
from apps.contacts.models import Contact
from apps.flows.models import Flow, FlowRun
from apps.marketplace.models import MarketTemplate
from apps.notifications.models import Notification
from apps.projects.models import Project
from apps.workspaces.models import Membership, Workspace

from .seed_demo import BOT_ID, PROJECT_ID, WORKSPACE_ID

#: The empty tenant the seed adds so the workspace switcher has two entries.
SPARE_WORKSPACE_ID = "yangi-ish-maydoni"

#: The account the seed invents besides the owner. The owner itself is kept:
#: it is the login whoever runs this is signed in as.
DEMO_MEMBER_EMAIL = "jasur@sunrise.uz"

#: Catalogue entries the seed publishes, including the one it attributes to the
#: demo workspace itself.
DEMO_TEMPLATE_IDS = ["keyword-dm-funnel", "after-hours-autoreply", "sunrise-course-funnel"]


class Command(BaseCommand):
    help = "Namuna (demo) ma'lumotlarini o'chiradi, haqiqiy yozuvlarga tegmaydi."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Faqat nimalar o'chishini ko'rsatadi")

    @transaction.atomic
    def handle(self, *args, **options):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        dry = options["dry_run"]
        loud = options["verbosity"] > 0
        removed: list[tuple[str, int]] = []

        def drop(label: str, queryset) -> None:
            count = queryset.count()
            if count and not dry:
                queryset.delete()
            if count:
                removed.append((label, count))

        demo_flows = list(Flow.objects.filter(project_id=PROJECT_ID).values_list("id", flat=True))

        # Analytics rows carry their bot and flow as plain ids, not foreign
        # keys, so nothing about deleting the bot would take them with it.
        drop("analitika hodisalari", Event.objects.filter(Q(bot_id=BOT_ID) | Q(flow_id__in=demo_flows)))
        drop("suhbatlar", FlowRun.objects.filter(flow_id__in=demo_flows))
        drop("kontaktlar", Contact.objects.filter(bot_id=BOT_ID))
        drop("oqimlar", Flow.objects.filter(project_id=PROJECT_ID))
        drop("botlar", Bot.objects.filter(pk=BOT_ID))
        drop("loyihalar", Project.objects.filter(pk=PROJECT_ID))

        drop("hisob-fakturalar", Invoice.objects.filter(workspace_id=WORKSPACE_ID))
        drop("obuna", Subscription.objects.filter(workspace_id=WORKSPACE_ID))
        drop("bildirishnomalar", Notification.objects.filter(workspace_id=WORKSPACE_ID))
        drop("market shablonlari", MarketTemplate.objects.filter(pk__in=DEMO_TEMPLATE_IDS))

        drop("a'zoliklar", Membership.objects.filter(email=DEMO_MEMBER_EMAIL))
        drop("foydalanuvchilar", User.objects.filter(email=DEMO_MEMBER_EMAIL))
        drop("bo'sh ish maydoni", Workspace.objects.filter(pk=SPARE_WORKSPACE_ID))

        workspace = Workspace.objects.filter(pk=WORKSPACE_ID).first()
        if workspace and workspace.is_demo:
            removed.append(("«Demo ma'lumot» belgisi olindi", 1))
            if not dry:
                # Without a subscription behind it, "Pro" would be the last
                # made-up number left on the screen.
                workspace.is_demo = False
                workspace.plan_key = "start"
                workspace.save(update_fields=["is_demo", "plan_key"])

        if not loud:
            return
        if not removed:
            self.stdout.write("Namuna ma'lumot topilmadi — baza toza.")
            return

        for label, count in removed:
            self.stdout.write(f"  {'o‘chiriladi' if dry else 'o‘chirildi'}: {label} · {count}")
        if dry:
            self.stdout.write(self.style.WARNING("Sinov rejimi — hech narsa o'chirilmadi."))
        else:
            self.stdout.write(self.style.SUCCESS("Namuna ma'lumot tozalandi."))
