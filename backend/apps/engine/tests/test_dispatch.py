"""Routing: which flow answers which update, and with what."""

from .base import *  # noqa: F401,F403


class TriggerIndexTests(EngineTestCase):
    def test_handler_kinds_become_rows_with_derived_priority(self):
        flow = self.make_flow(
            [
                {
                    "id": "t1",
                    "type": "trigger",
                    "title": "Handler",
                    "dmsTrigger": {"kinds": ["command", "photo", "any"], "command": "menyu"},
                }
            ],
            [],
        )

        rows = {row.kind: row.priority for row in flow.triggers.all()}
        self.assertEqual(rows["command"], 1, "an explicit command is an exact match")
        self.assertEqual(rows["media"], 2, "a content-type filter only narrows the message")
        self.assertEqual(rows["any"], 3, "the fallback runs last")

    def test_business_window_lifts_a_catch_all_above_the_unscheduled_one(self):
        flow = self.make_flow(
            [
                {
                    "id": "b1",
                    "type": "trigger",
                    "business": {
                        "messageTypes": ["new"],
                        "match": "any",
                        "schedule": {"mode": "outside", "days": [1], "from": "09:00", "to": "18:00"},
                    },
                }
            ],
            [],
            module_key="business",
        )
        self.assertEqual(flow.triggers.get().priority, 2)

    def test_reindex_replaces_the_previous_graph(self):
        flow = self.make_flow(
            [{"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "eski"}}], []
        )
        flow.nodes = [{"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "yangi"}}]
        flow.save(update_fields=["nodes"])
        reindex_triggers(flow)

        self.assertEqual(FlowTrigger.objects.filter(flow=flow).count(), 1)
        self.assertEqual(FlowTrigger.objects.get(flow=flow).command, "yangi")


class DispatchTests(EngineTestCase):
    def test_start_command_runs_the_main_flow_and_sends_its_message(self):
        self.make_flow(
            [
                {"id": "n1", "type": "start", "title": "/start"},
                {"id": "n2", "type": "message", "title": "Salom", "text": "Salom {{mijoz_ismi}}!"},
            ],
            [{"id": "e1", "from": "n1", "port": "out", "to": "n2"}],
            is_main=True,
        )

        result = dispatch(self.bot, message_update("/start"))

        self.assertEqual(result["reason"], "started")
        run = FlowRun.objects.get(pk=result["runId"])
        self.assertEqual(run.status, FlowRun.Status.DONE)
        sent = run.steps.filter(actor="bot").get()
        self.assertEqual(sent.text, "Salom Dilnoza!", "the contact's name is filled in before sending")
        self.assertEqual(sent.payload["method"], "sendMessage")

    def test_an_exact_command_wins_over_a_catch_all(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "zaxira"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            name="Zaxira",
        )
        exact = self.make_flow(
            [
                {"id": "c2", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "m2", "type": "message", "text": "690 000 so'm"},
            ],
            [{"id": "e2", "from": "c2", "port": "out", "to": "m2"}],
            name="Narx",
        )

        result = dispatch(self.bot, message_update("/narx"))
        self.assertEqual(result["flowId"], exact.id)

    def test_a_disabled_flow_never_answers(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "salom"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            enabled=False,
        )
        # No run starts, and nothing answers: a disabled flow is a flow whose
        # author switched it off, and the bot has nothing else to say.
        self.assertEqual(dispatch(self.bot, message_update("salom"))["reason"], "no_trigger")
        self.assertEqual(FlowRun.objects.count(), 0)

    def test_a_condition_takes_the_branch_its_rules_say(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {
                    "id": "if1",
                    "type": "condition",
                    "condition": {
                        "combinator": "AND",
                        "rules": [{"id": "r1", "field": "message_text", "operator": "contains", "value": "narx"}],
                    },
                },
                {"id": "yes", "type": "message", "text": "Narxlar ro'yxati"},
                {"id": "no", "type": "message", "text": "Tushunmadim"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "if1"},
                {"id": "e2", "from": "if1", "port": "yes", "to": "yes"},
                {"id": "e3", "from": "if1", "port": "no", "to": "no"},
            ],
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("narx qancha?"))["runId"])
        self.assertEqual(run.steps.filter(actor="bot").get().text, "Narxlar ro'yxati")

    def test_a_keyboard_parks_until_a_button_is_pressed(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Tanlang",
                    "buttons": [{"id": "b1", "label": "Kurslar", "kind": "callback"}],
                },
                {"id": "m2", "type": "message", "text": "Kurslar ro'yxati"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
            ],
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])
        self.assertEqual(run.status, FlowRun.Status.WAITING)

        dispatch(
            self.bot,
            {
                "update_id": 2,
                "callback_query": {
                    "id": "cq1",
                    "from": {"id": 555, "first_name": "Dilnoza"},
                    "message": {"message_id": 11, "chat": {"id": 555, "type": "private"}},
                    "data": "btn:b1",
                },
            },
        )

        run.refresh_from_db()
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertIn("Kurslar ro'yxati", [step.text for step in run.steps.all()])

    def test_a_blocked_contact_is_recorded_and_not_written_to(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "salom"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )
        Contact.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            telegram_user_id=555,
            chat_id=555,
            first_name="Dilnoza",
            is_blocked=True,
            last_seen_at=timezone.now(),
        )

        result = dispatch(self.bot, message_update("salom"))
        self.assertEqual(result["reason"], "contact_blocked")
        self.assertEqual(FlowRun.objects.count(), 0)

    def test_a_module_the_bot_has_switched_off_is_not_even_looked_at(self):
        self.bot.enabled_modules = ["business"]
        self.bot.save(update_fields=["enabled_modules"])
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "salom"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )
        self.assertEqual(dispatch(self.bot, message_update("salom"))["reason"], "no_trigger")


class VariableRenderingTests(EngineTestCase):
    def test_the_placeholders_the_editor_inserts_are_the_ones_that_resolve(self):
        # These names come from the editor's own variable menu
        # (frontend/src/features/flow-builder/lib/variables.ts) — a runtime
        # with names of its own would render every one of them as braces.
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "salom"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "{{user.first_name}} · {{user.username}} · {{message.text}} · {{chat.type}}",
                },
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/salom"))["runId"])
        sent = run.steps.filter(actor="bot").get()
        self.assertEqual(sent.text, "Dilnoza · @dilnoza · /salom · private")

    def test_an_unknown_placeholder_keeps_its_braces(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "Salom {{yoq.nimadir}}"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("salom"))["runId"])
        # A visible "{{yoq.nimadir}}" is a bug the author can see; an empty gap
        # is one they cannot.
        self.assertEqual(run.steps.filter(actor="bot").get().text, "Salom {{yoq.nimadir}}")


class ReplyTargetTests(EngineTestCase):
    def test_a_join_request_is_answered_in_the_applicants_private_chat(self):
        self.bot.enabled_modules = ["groups"]
        self.bot.save(update_fields=["enabled_modules"])
        self.make_flow(
            [
                {"id": "j1", "type": "joinrequest", "title": "So'rov"},
                {"id": "m1", "type": "message", "text": "So'rovingiz qabul qilindi"},
            ],
            [{"id": "e1", "from": "j1", "port": "out", "to": "m1"}],
            module_key="groups",
        )

        result = dispatch(
            self.bot,
            {
                "update_id": 3,
                "chat_join_request": {
                    "chat": {"id": -100500, "type": "supergroup", "title": "Sunrise"},
                    "from": {"id": 555, "first_name": "Dilnoza"},
                    "user_chat_id": 555,
                    "date": 0,
                },
            },
        )

        run = FlowRun.objects.get(pk=result["runId"])
        sent = run.steps.filter(actor="bot").get()
        # The request arrives on the group, which the bot cannot write to on
        # the applicant's behalf — Telegram hands over `user_chat_id` for this.
        self.assertEqual(sent.payload["payload"]["chat_id"], 555)

    def test_a_group_message_does_not_overwrite_the_contacts_private_chat(self):
        contact = Contact.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            telegram_user_id=555,
            chat_id=555,
            chat_type="private",
            first_name="Dilnoza",
        )
        self.bot.enabled_modules = ["groups"]
        self.bot.save(update_fields=["enabled_modules"])

        dispatch(self.bot, message_update("salom", chat_type="supergroup"))

        contact.refresh_from_db()
        self.assertEqual(contact.chat_id, 555, "the private chat is the contact's own; a group is not")

    def test_a_pressed_button_is_acknowledged_so_it_stops_spinning(self):
        from unittest.mock import patch

        with patch("apps.telegram.client.TelegramClient.call", autospec=True) as call:
            call.return_value = {"message_id": 1}
            dispatch(
                self.bot,
                {
                    "update_id": 4,
                    "callback_query": {
                        "id": "cq9",
                        "from": {"id": 555, "first_name": "Dilnoza"},
                        "message": {"message_id": 11, "chat": {"id": 555, "type": "private"}},
                        "data": "btn:b1",
                    },
                },
            )

        methods = [args[1] for args, _ in (c for c in call.call_args_list)]
        self.assertIn("answerCallbackQuery", methods, "Telegram leaves the button loading until this arrives")


class ParkedRunRoutingTests(EngineTestCase):
    """What a parked run may claim, and what it has to let through."""

    def _keyboard_flow(self):
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Tanlang",
                    "buttons": [{"id": "b1", "label": "Kurslar", "kind": "callback"}],
                },
                {"id": "m2", "type": "message", "text": "Kurslar ro'yxati"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
            ],
            name="Menyu",
        )

    def test_typing_past_a_keyboard_starts_the_flow_that_answers_it(self):
        parked_flow = self._keyboard_flow()
        keyword_flow = self.make_flow(
            [
                {"id": "k1", "type": "trigger", "dmsTrigger": {"kinds": ["keyword"], "keywords": "narx"}},
                {"id": "k2", "type": "message", "text": "690 000 so'm"},
            ],
            [{"id": "e1", "from": "k1", "port": "out", "to": "k2"}],
            name="Narx",
        )

        parked = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])
        self.assertEqual(parked.status, FlowRun.Status.WAITING)

        result = dispatch(self.bot, message_update("narx qancha?"))

        self.assertEqual(result["flowId"], keyword_flow.id, "a keyboard is not a blocking prompt")
        parked.refresh_from_db()
        self.assertEqual(parked.status, FlowRun.Status.WAITING, "and the keyboard is still tappable")
        self.assertEqual(parked.flow_id, parked_flow.id)

class ReplyKeyboardTests(EngineTestCase):
    """A reply keyboard branches on the label Telegram sends back."""

    def _flow(self):
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Tanlang",
                    "buttonMode": "reply",
                    "buttons": [
                        {"id": "b1", "label": "Kurslar", "kind": "callback"},
                        {"id": "b2", "label": "Manzil", "kind": "callback"},
                    ],
                },
                {"id": "m2", "type": "message", "text": "Kurslar ro'yxati"},
                {"id": "m3", "type": "message", "text": "Chilonzor 12"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
                {"id": "e3", "from": "m1", "port": "btn:b2", "to": "m3"},
            ],
        )

    def test_the_run_waits_for_a_row_to_be_tapped(self):
        self._flow()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])
        self.assertEqual(run.status, FlowRun.Status.WAITING, "a reply keyboard is a branch, not a pass-through")

    def test_the_tapped_label_picks_its_own_branch(self):
        self._flow()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])

        self.assertEqual(dispatch(self.bot, message_update("Manzil"))["reason"], "resumed")

        run.refresh_from_db()
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual([step.text for step in run.steps.filter(actor="bot")], ["Tanlang", "Chilonzor 12"])

    def test_the_keyboard_is_sent_as_a_reply_keyboard(self):
        self._flow()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])
        markup = run.steps.filter(actor="bot").get().payload["payload"]["reply_markup"]

        self.assertIn("keyboard", markup)
        self.assertEqual([row[0]["text"] for row in markup["keyboard"]], ["Kurslar", "Manzil"])


class FallbackHandlerTests(EngineTestCase):
    def test_a_real_start_handler_still_wins_over_the_fallback(self):
        main = self.make_flow(
            [
                {"id": "n1", "type": "start"},
                {"id": "n2", "type": "message", "text": "Asosiy menyu"},
            ],
            [{"id": "e1", "from": "n1", "port": "out", "to": "n2"}],
            is_main=True,
            name="Asosiy",
        )
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "zaxira"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            name="Zaxira",
        )

        self.assertEqual(dispatch(self.bot, message_update("/start"))["flowId"], main.id)

    def test_without_a_start_handler_the_fallback_answers_it(self):
        fallback = self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "Salom!"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            name="Zaxira",
        )

        # /start is the first thing every Telegram user sends; a bot that
        # answers everything except that one reads as broken.
        self.assertEqual(dispatch(self.bot, message_update("/start"))["flowId"], fallback.id)


class ChatLockTests(EngineTestCase):
    """BUG-005: one update per conversation at a time, across workers.

    Two Celery workers resuming the same WAITING run at the same node each
    stored their text under that node's variable and each sent the next
    question — the customer saw doubled questions and an intake's answers
    shredded across its variables. Eager test Celery is serial, so the race
    itself cannot run here; what is pinned is the lock that prevents it.
    """

    def test_a_held_chat_makes_the_second_dispatch_wait(self):
        from apps.engine.dispatch import chat_lock
        from apps.engine.events import parse_update

        update = message_update("salom")
        event = parse_update(update)
        with chat_lock(self.bot.id, event.chat_id):
            # The same conversation: refused until the holder is done.
            import apps.engine.dispatch as dispatch_module

            with mock.patch.object(dispatch_module, "CHAT_LOCK_WAIT", 0):
                with self.assertRaises(dispatch_module.ChatBusy):
                    with chat_lock(self.bot.id, event.chat_id):
                        pass
            # A different conversation is not queued behind this one.
            other = parse_update(message_update("salom", user_id=777))
            with chat_lock(self.bot.id, other.chat_id):
                pass

    def test_the_lock_is_released_after_the_update_and_after_a_failure(self):
        from apps.engine.dispatch import chat_lock
        from apps.engine.events import parse_update

        event = parse_update(message_update("salom"))
        with chat_lock(self.bot.id, event.chat_id):
            pass
        with self.assertRaises(RuntimeError):
            with chat_lock(self.bot.id, event.chat_id):
                raise RuntimeError("walk exploded")
        # Both exits freed the chat.
        with chat_lock(self.bot.id, event.chat_id):
            pass

    def test_dispatch_takes_the_lock_for_the_updates_chat(self):
        import apps.engine.dispatch as dispatch_module

        with mock.patch.object(dispatch_module, "chat_lock", wraps=dispatch_module.chat_lock) as guard:
            dispatch(self.bot, message_update("salom"))
        self.assertEqual(guard.call_args[0], (self.bot.id, 555), "the lock is keyed by the conversation")


class ContactLimitTests(EngineTestCase):
    """The plan's `contacts` cap, on the one path that files a person.

    Every incoming update passes through `upsert_contact`, so this is the only
    seam where the cap can be applied — and it is a webhook, which settles both
    halves of how. It cannot raise: Telegram retries anything it is not
    answered 200, so a refusal thrown here becomes the same update forever. And
    it must not silence the bot: `apps.billing.services` states the trade
    outright — a bot that stops answering because a counter is full is a worse
    failure than a contact that goes unfiled.

    So what a full plan costs is precisely the filing. The person still writes,
    the flow still matches, the bot still answers. What they lose is a row in
    Kontaktlar, a thread in Suhbatlar, and — because a run without a contact
    has nothing to be waiting *on* — the ability to be asked a question and
    have their answer recognised. That last one is the sharp edge of this
    decision and it is pinned below rather than left to be discovered.
    """

    def setUp(self) -> None:
        super().setUp()
        from django.core.cache import cache

        from apps.billing.models import Plan, Subscription

        self.workspace.plan_key = "start"
        self.workspace.save(update_fields=["plan_key"])
        self.plan = Plan.objects.create(key="start", name="Free", limits={"contacts": 1})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.workspace.refresh_from_db()
        self.bot.refresh_from_db()
        cache.clear()

    def _greeting_flow(self):
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "Salom!"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

    def test_the_first_contact_under_the_cap_is_filed_as_before(self):
        self._greeting_flow()

        dispatch(self.bot, message_update("salom", user_id=601))

        self.assertEqual(Contact.objects.count(), 1)

    def test_a_new_person_over_the_cap_is_not_filed(self):
        self._greeting_flow()
        dispatch(self.bot, message_update("salom", user_id=601))

        dispatch(self.bot, message_update("salom", user_id=602))

        self.assertEqual(Contact.objects.count(), 1, "the seat was taken")
        self.assertFalse(Contact.objects.filter(telegram_user_id=602).exists())

    def test_the_bot_still_answers_somebody_it_could_not_file(self):
        """The whole point of the non-raising half of the guard.

        A silent bot is a broken product to the person writing to it, and they
        are the one party in this story with no way to know why.
        """
        self._greeting_flow()
        dispatch(self.bot, message_update("salom", user_id=601))

        result = dispatch(self.bot, message_update("salom", user_id=602))

        self.assertEqual(result["reason"], "started")
        run = FlowRun.objects.get(pk=result["runId"])
        self.assertIsNone(run.contact_id)
        sent = run.steps.filter(actor="bot").get()
        self.assertEqual(sent.text, "Salom!")
        self.assertEqual(
            sent.payload["payload"]["chat_id"], 602, "answered in their own chat, contact or no contact"
        )

    def test_the_conversation_already_filed_carries_on(self):
        """A cap on new rows is not a cap on the people already in them."""
        flow = self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "ariza"}},
                {"id": "q1", "type": "language", "text": "Tilni tanlang.",
                 "language": {"options": [{"id": "o1", "code": "uz", "label": "O'zbekcha"}]}},
                {"id": "m1", "type": "message", "text": "Rahmat!"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "q1"},
                {"id": "e2", "from": "q1", "port": "out", "to": "m1"},
            ],
        )
        dispatch(self.bot, message_update("/ariza", user_id=601))
        # The seat is gone by the time they answer — this must change nothing.
        dispatch(self.bot, message_update("salom", user_id=602))

        result = dispatch(self.bot, pick_language("uz", user_id=601))

        self.assertEqual(result["reason"], "resumed")
        run = FlowRun.objects.get(flow=flow, contact__telegram_user_id=601)
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(run.steps.filter(actor="bot").last().text, "Rahmat!")

    def test_an_unfiled_person_is_not_counted_as_a_new_contact(self):
        """`newContacts` is a count of rows, and no row was written.

        The analytics screen and the Kontaktlar list are two readings of the
        same fact, so an event here would put a number on the dashboard that
        no list can be opened to explain.
        """
        from apps.analytics.models import Event, Metric

        self._greeting_flow()
        dispatch(self.bot, message_update("salom", user_id=601))
        dispatch(self.bot, message_update("salom", user_id=602))

        self.assertEqual(Event.objects.filter(metric=Metric.NEW_CONTACT).count(), 1)

    def test_the_workspace_is_told_that_new_people_are_going_unfiled(self):
        """Otherwise this is a silent failure: the bar reads full, and the only
        witness to what that costs is a customer who never appears in the list."""
        from apps.notifications.models import Notification

        self._greeting_flow()
        dispatch(self.bot, message_update("salom", user_id=601))
        dispatch(self.bot, message_update("salom", user_id=602))

        notification = Notification.objects.get(kind=Notification.Kind.BILLING)
        self.assertIn("Free", notification.text)
        self.assertIn("saqlanmayapti", notification.text)

    def test_the_warning_arrives_before_the_first_person_is_dropped(self):
        """Warned at the door as well as at the wall.

        Told only when the cap is full, a workspace would learn of it from a
        notice saying customers are already being lost — after the first ones
        already had been. The last seat is where that sentence is still worth
        something.

        The cache is cleared between arrivals because the probe window
        (`notifications.services.PROBE_SECONDS`) is five minutes and four
        contacts arrive here in four milliseconds. On a stand the window is the
        point; in a test it is the only thing in the way.
        """
        from django.core.cache import cache

        from apps.notifications.models import Notification

        self.plan.limits = {"contacts": 5}
        self.plan.save(update_fields=["limits"])
        for user_id in (611, 612, 613, 614):
            cache.clear()
            dispatch(self.bot, message_update("salom", user_id=user_id))

        notification = Notification.objects.get(kind=Notification.Kind.BILLING)
        self.assertIn("tugayapti", notification.title, "four of five: warned, not refused")
        self.assertEqual(Contact.objects.count(), 4, "and every one of them was filed")

    def test_a_returning_contact_costs_no_count_at_all(self):
        """The price of the guard, measured where it would be paid.

        `get_or_create` cannot say in advance whether it will create, so
        counting before it would put a `COUNT(*)` on *every incoming message*
        of every capped workspace. Looking first and counting only on a miss
        moves that cost to once per new person.
        """
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.engine.dispatch import upsert_contact
        from apps.engine.events import parse_update

        self._greeting_flow()
        dispatch(self.bot, message_update("salom", user_id=601))

        event = parse_update(message_update("yana", user_id=601))
        with CaptureQueriesContext(connection) as queries:
            upsert_contact(self.bot, event)

        sql = " ".join(query["sql"] for query in queries)
        self.assertNotIn("COUNT", sql.upper(), "a returning contact must not pay for the cap")
        self.assertEqual(len(queries), 2, "one SELECT to find them, one UPDATE to refresh them")

    def test_an_uncapped_plan_never_counts_contacts(self):
        """A plan that does not declare the key does not pay for it either."""
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.engine.dispatch import upsert_contact
        from apps.engine.events import parse_update

        self.plan.limits = {"contacts": None}
        self.plan.save(update_fields=["limits"])

        event = parse_update(message_update("salom", user_id=603))
        with CaptureQueriesContext(connection) as queries:
            contact, created = upsert_contact(self.bot, event)

        self.assertTrue(created)
        self.assertNotIn("COUNT", " ".join(query["sql"] for query in queries).upper())

    def test_two_updates_from_one_new_person_still_make_one_contact(self):
        """The race `get_or_create` used to absorb, still absorbed.

        The chat lock serialises one conversation, not one *person*: the same
        Telegram user writing in a group and in their own chat is two chat ids
        and two workers, and `uniq_contact_per_bot` is what stops the second.

        Staged rather than raced — two connections cannot be had inside one
        test transaction. The rival row is written by hand and the INSERT is
        made to fail the way the constraint would fail it; the savepoint around
        that insert is stood down for the same reason, since on a real stand
        the rival belongs to another connection and rolling ours back cannot
        touch it, while here it would take the fixture with it.
        """
        from contextlib import nullcontext

        from django.db import IntegrityError

        import apps.engine.dispatch as dispatch_module
        from apps.engine.dispatch import upsert_contact
        from apps.engine.events import parse_update

        event = parse_update(message_update("salom", user_id=604))
        real_create = Contact.objects.create

        def create_after_a_rival(**kwargs):
            # The other worker got there first, between our SELECT and this INSERT.
            real_create(**{**kwargs, "id": "rival"})
            raise IntegrityError("uniq_contact_per_bot")

        with mock.patch.object(dispatch_module.transaction, "atomic", nullcontext):
            with mock.patch.object(Contact.objects, "create", side_effect=create_after_a_rival):
                contact, created = upsert_contact(self.bot, event)

        self.assertIsNotNone(contact, "the loser reads the row the winner wrote")
        self.assertEqual(contact.pk, "rival")
        self.assertFalse(created, "and does not announce it as new a second time")
        self.assertEqual(Contact.objects.count(), 1)


class MessageLimitWarningTests(EngineTestCase):
    """The `messages` limit, which is warned about and never enforced.

    Every other cap in the product refuses. This one cannot: the number moves
    *after* a send that has already left the machine, so by the time it moves
    there is nothing left to refuse — and refusing earlier would be a bot going
    quiet mid-conversation because a counter filled, which `apps.billing.services`
    names as the worse failure. So the plan's ceiling is watched rather than
    held, and the obligation that replaces enforcement is that somebody is told.
    """

    def setUp(self) -> None:
        super().setUp()
        from django.core.cache import cache

        from apps.billing.models import Plan, Subscription

        self.workspace.plan_key = "start"
        self.workspace.save(update_fields=["plan_key"])
        self.plan = Plan.objects.create(key="start", name="Free", limits={"messages": 1})
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.workspace.refresh_from_db()
        self.bot.refresh_from_db()
        cache.clear()
        self.flow = self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "Salom!"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

    def test_a_full_message_limit_stops_absolutely_nothing(self):
        """The property the whole design turns on, pinned where it can regress."""
        dispatch(self.bot, message_update("salom", user_id=701))

        result = dispatch(self.bot, message_update("yana", user_id=701))

        run = FlowRun.objects.get(pk=result["runId"])
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(run.steps.filter(actor="bot").get().text, "Salom!")

    def test_the_workspace_is_told_instead(self):
        from apps.notifications.models import Notification

        dispatch(self.bot, message_update("salom", user_id=701))
        dispatch(self.bot, message_update("yana", user_id=701))

        notification = Notification.objects.get(kind=Notification.Kind.BILLING)
        self.assertIn("Free", notification.text)
        self.assertIn("davom etmoqda", notification.text, "and told that nothing stopped")

    def test_a_test_run_from_the_editor_counts_for_nothing(self):
        """Nothing left the machine, so nothing was used and nobody is warned."""
        from apps.analytics.models import Event, Metric
        from apps.engine.runner import start_run
        from apps.notifications.models import Notification

        start_run(flow=self.flow, entry_node_id="m1", is_test=True)

        self.assertEqual(Event.objects.filter(metric=Metric.MESSAGE).count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

    def test_the_watch_rides_on_the_event_rather_than_a_second_lookup(self):
        """Reached after every message the product sends, so it may not add a query.

        `record_event` resolves the tenant out of the flow one line above it,
        which leaves the workspace in memory; asking the *run* for the same row
        would be a second SELECT behind every send. One is the whole assertion.
        """
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        from apps.engine.runner import _count_message

        result = dispatch(self.bot, message_update("salom", user_id=701))
        run = FlowRun.objects.get(pk=result["runId"])  # freshly loaded: nothing cached

        with CaptureQueriesContext(connection) as queries:
            _count_message(run)

        fetched = [query for query in queries if "workspaces_workspace" in query["sql"]]
        self.assertEqual(len(fetched), 1, "the tenant is read once and reused, not read twice")
