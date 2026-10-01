"""Whole conversations, end to end, including the ways they go wrong."""

from .base import *  # noqa: F401,F403


class CommandsInterruptTests(EngineTestCase):
    """A command is an instruction, not an answer to the question on screen."""

    def setUp(self) -> None:
        super().setUp()
        self.make_intake_flow()

    def test_start_halfway_through_restarts_instead_of_being_stored_as_a_name(self):
        first = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/start"))["runId"])
        self.assertEqual(first.status, FlowRun.Status.WAITING)

        result = dispatch(self.bot, message_update("/start"))

        self.assertEqual(result["reason"], "started", "a command starts over, it does not answer")
        first.refresh_from_db()
        self.assertEqual(first.status, FlowRun.Status.DONE)
        self.assertIn("/start", first.error)
        self.assertEqual(FlowRun.objects.filter(status=FlowRun.Status.WAITING).count(), 1, "exactly one live run")

    def test_an_unknown_command_does_not_become_an_answer_either(self):
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/start"))["runId"])

        # Nothing answers /help, so no flow claims it and nothing is sent. What
        # this test is actually about survives either way: the parked question
        # must not be fed a command as its answer.
        result = dispatch(self.bot, message_update("/help"))

        self.assertEqual(result["reason"], "no_trigger")
        run.refresh_from_db()
        self.assertEqual(run.status, FlowRun.Status.WAITING)
        self.assertEqual(run.steps.filter(actor="user").count(), 0)


class MultipleParkedRunsTests(EngineTestCase):
    def test_a_tap_answers_the_keyboard_it_came_from_not_the_newest_run(self):
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
            name="Menyu",
        )
        self.make_flow(
            [
                {"id": "k1", "type": "trigger", "dmsTrigger": {"kinds": ["keyword"], "keywords": "narx"}},
                {"id": "q1", "type": "language", "text": "Qaysi til?",
                 "language": {"options": [{"id": "o1", "code": "uz", "label": "O'zbekcha"}]}},
                {"id": "k2", "type": "message", "text": "Aniqlashtiramiz"},
            ],
            [
                {"id": "e1", "from": "k1", "port": "out", "to": "q1"},
                {"id": "e2", "from": "q1", "port": "out", "to": "k2"},
            ],
            name="Narx",
        )

        keyboard = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])
        question = FlowRun.objects.get(pk=dispatch(self.bot, message_update("narx qancha?"))["runId"])
        self.assertEqual(keyboard.status, FlowRun.Status.WAITING)
        self.assertEqual(question.status, FlowRun.Status.WAITING)

        dispatch(
            self.bot,
            {
                "update_id": 7,
                "callback_query": {
                    "id": "cq1",
                    "from": {"id": 555, "first_name": "Dilnoza"},
                    "message": {"message_id": 12, "chat": {"id": 555, "type": "private"}},
                    "data": "btn:b1",
                },
            },
        )

        keyboard.refresh_from_db()
        question.refresh_from_db()
        self.assertEqual(keyboard.status, FlowRun.Status.DONE, "the tap belongs to the keyboard that drew it")
        self.assertIn("Kurslar ro'yxati", [step.text for step in keyboard.steps.all()])
        self.assertEqual(question.status, FlowRun.Status.WAITING, "and the question is still waiting for words")


class DuplicateDeliveryTests(EngineTestCase):
    """Telegram re-delivers what it did not get a prompt answer for."""

    def setUp(self) -> None:
        super().setUp()
        self.make_intake_flow()

    def test_the_same_update_is_handled_once(self):
        update = message_update("/start")

        first = dispatch(self.bot, update)
        second = dispatch(self.bot, update)

        self.assertEqual(first["reason"], "started")
        self.assertEqual(second["reason"], "duplicate")
        self.assertEqual(FlowRun.objects.count(), 1, "a re-delivery must not start a second conversation")
        run = FlowRun.objects.get()
        self.assertEqual(run.steps.filter(actor="bot").count(), 1, "and must not send the message twice")

    def test_a_re_delivered_answer_is_not_fed_to_the_block_twice(self):
        dispatch(self.bot, message_update("/start"))
        answer = pick_language("uz")
        answer["update_id"] = 4242

        dispatch(self.bot, answer)
        dispatch(self.bot, answer)

        run = FlowRun.objects.get()
        # One pick, counted once: the language prompt and the thank-you are the
        # two bot lines, the tap is the one user line, and the re-delivery adds
        # nothing.
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(run.steps.filter(actor="user").count(), 1)
        self.assertEqual(run.steps.filter(actor="bot").count(), 2)

    def test_the_same_update_id_from_another_bot_is_its_own(self):
        from apps.bots.models import Bot

        other = Bot.objects.create(
            id="b2", workspace=self.workspace, project=self.project, handle="@b2", token="t",
            enabled_modules=["dms"],
        )
        from apps.flows.services import ensure_main_flow

        ensure_main_flow(workspace=self.workspace, project=self.project, bot=other, graph=intake_graph())

        update = message_update("/start")
        self.assertEqual(dispatch(self.bot, update)["reason"], "started")
        self.assertEqual(dispatch(other, update)["reason"], "started", "update ids are per bot")


class TestRunFidelityTests(EngineTestCase):
    """What the editor's test chat shows has to be what the bot would send."""

    def test_a_test_run_fills_in_variables_the_same_way_a_real_one_does(self):
        from apps.engine.runner import resume_with_reply, start_run

        flow = self.make_flow(
            [
                {"id": "n1", "type": "start", "title": "start", "text": ""},
                {"id": "n2", "type": "language", "text": "Tilni tanlang.",
                 "language": {"options": [{"id": "o1", "code": "uz", "label": "O'zbekcha"}]}},
                {"id": "n3", "type": "message", "text": "Tanlangan til: {{mijoz_tili}}"},
            ],
            [
                {"id": "e1", "from": "n1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "out", "to": "n3"},
            ],
            name="Til",
        )

        run = start_run(flow=flow, entry_node_id="n1", is_test=True)
        self.assertEqual(run.status, FlowRun.Status.WAITING)

        # The tap's callback data, exactly as the test chat forwards it.
        resume_with_reply(run, text=f"{LANGUAGE_PREFIX}uz")
        run.refresh_from_db()

        self.assertEqual(run.status, FlowRun.Status.DONE)
        last = run.steps.filter(actor="bot").last().text
        self.assertIn("uz", last, "a preview showing {{mijoz_tili}} is a preview of nothing")
        self.assertNotIn("{{", last)

    def test_a_test_run_sends_nothing_to_telegram(self):
        from apps.engine.runner import start_run

        flow = self.make_intake_flow()

        with mock.patch("apps.telegram.client.TelegramClient.call") as call:
            start_run(flow=flow, entry_node_id=flow.nodes[0]["id"], is_test=True)

        call.assert_not_called()

