"""What happens to the message already on screen when the next one is due.

Two halves, and they are tested apart on purpose. `apps.engine.transitions` is a
pure function of two block dicts — the editor asks it the same questions the
runtime does, so it is worth knowing on its own that it answers them the same
way. The ladder in `runner._deliver` is the other half: what actually goes out
when Telegram disagrees with the matrix.
"""

from .base import *  # noqa: F401,F403

from apps.engine import transitions
from apps.engine.runner import SCREEN_SENT_AT, start_run


class MatrixTests(TestCase):
    """The part that needs no database: what Telegram will and will not allow."""

    def test_text_can_become_text(self):
        self.assertTrue(transitions.can_edit("text", "text"))

    def test_text_can_become_media(self):
        """Bot API 10.3, `editMessageMedia`: "…or to replace a text or a rich
        message with a media." A text menu turning into a photo card is one
        call, not a delete and a resend."""
        self.assertTrue(transitions.can_edit("text", "photo"))
        self.assertTrue(transitions.can_edit("text", "video"))

    def test_media_can_never_become_text(self):
        """`editMessageText` edits "text, rich and game messages" — media is
        absent from that list, and there is no other method that would do it.
        This is the one direction the matrix genuinely closes."""
        self.assertFalse(transitions.can_edit("photo", "text"))

    def test_media_can_become_other_media(self):
        self.assertTrue(transitions.can_edit("photo", "video"))

    def test_an_invoice_can_be_edited_from_neither_side(self):
        self.assertFalse(transitions.can_edit("text", "invoice"))
        self.assertFalse(transitions.can_edit("invoice", "text"))

    def test_an_album_is_not_a_screen(self):
        """`sendMediaGroup` puts out several messages, so there is no single
        one for a later block to name."""
        self.assertFalse(transitions.can_edit("text", "album"))
        self.assertFalse(transitions.can_edit("album", "text"))

    def test_a_reply_keyboard_rules_editing_out(self):
        """Every `editMessage…` types `reply_markup` as `InlineKeyboardMarkup`.
        A reply keyboard is chat furniture and the only way to put one up is to
        send something."""
        node = {"type": "message", "text": "Salom", "buttonMode": "reply", "buttons": [{"id": "b1", "label": "Ha"}]}
        self.assertFalse(transitions.accepts_inline_keyboard(node))
        self.assertNotIn(transitions.EDIT, transitions.available("text", True, node))

    def test_a_block_with_no_keyboard_at_all_can_still_be_edited(self):
        node = {"type": "message", "text": "Rahmat"}
        self.assertIn(transitions.EDIT, transitions.available("text", True, node))

    def test_keeping_is_always_on_the_list(self):
        """The floor of the ladder. Whatever else is impossible, this is not."""
        for previous in ("text", "photo", "invoice", "album", ""):
            self.assertIn(transitions.KEEP, transitions.available(previous, False, {"type": "message"}))

    def test_clearing_buttons_needs_buttons_to_clear(self):
        node = {"type": "message", "text": "Salom"}
        self.assertNotIn(transitions.CLEAR_BUTTONS, transitions.available("text", False, node))
        self.assertIn(transitions.CLEAR_BUTTONS, transitions.available("text", True, node))

    def test_every_block_keeps_what_is_there_by_default(self):
        # «Menyu» was the one block that replaced the screen before it; it is
        # gone, so nothing auto-edits and every block keeps by default now.
        for node_type in ("message", "invoice", "language", "delay"):
            self.assertEqual(transitions.default_for({"type": node_type}, previous_inline=True), transitions.KEEP)

    def test_the_edge_outranks_the_block(self):
        node = {"type": "message", "incomingTransition": transitions.KEEP}
        self.assertEqual(transitions.resolve({"transition": transitions.EDIT}, node), transitions.EDIT)

    def test_the_block_outranks_the_default(self):
        self.assertEqual(transitions.resolve(None, {"type": "message", "incomingTransition": transitions.EDIT}), transitions.EDIT)

    def test_a_string_nothing_recognises_falls_through(self):
        """A graph written by an older editor, or by hand through the API.
        `flows.serializers` passes nodes and edges through unvalidated, so the
        runtime is the only thing standing between a typo and a decision."""
        self.assertEqual(transitions.resolve({"transition": "oldindan"}, {"type": "message"}, True), transitions.KEEP)


class DeleteTests(EngineTestCase):
    """Taking the old message away — what `edit` is for when `edit` cannot be."""

    def make_pair(self, transition: str, second: dict, **edge_extra):
        edge = {"id": "e2", "from": "m1", "port": "btn:b1", "to": "n2", "transition": transition, **edge_extra}
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {"id": "m1", "type": "message", "text": "Tanlang:", "buttons": [{"id": "b1", "label": "Rasm"}]},
                second,
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}, edge],
            name="O'chirish",
        )

    def photo(self) -> dict:
        return {"id": "n2", "type": "message", "contentKind": "photo",
                "mediaSource": {"kind": "url", "value": "https://x/y.jpg"}, "text": "Mana"}

    def calls(self, run) -> list[str]:
        return [step.payload.get("method", "") for step in run.steps.filter(actor="bot").order_by("created_at")]

    def tap(self):
        dispatch(self.bot, message_update("/menyu"))
        return FlowRun.objects.get(pk=dispatch(self.bot, callback_update("btn:b1"))["runId"])

    def sent_methods(self, run) -> list[str]:
        """Every call the bot made, including the ones that said nothing.

        A delete leaves no step of its own — nothing was told to the customer —
        so the trace alone cannot show it. The offline client keeps the record.
        """
        return [call["method"] for call in self.client_calls]

    def setUp(self) -> None:
        super().setUp()
        self.client_calls: list[dict] = []
        original = TelegramClient.call

        def record(client, method, payload=None):
            self.client_calls.append({"method": method, "payload": payload or {}})
            return original(client, method, payload)

        patcher = mock.patch.object(TelegramClient, "call", record)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_photo_after_a_text_menu_deletes_rather_than_piling_up(self):
        """The case that asked for this. `editMessageText` cannot make a photo
        out of a text message's *successor* here — the author picked delete —
        so the menu goes and the photo takes the screen."""
        self.make_pair(transitions.DELETE, self.photo())
        run = self.tap()

        # Sliced rather than compared whole: what this test is about is the
        # order of the four calls the transition makes, and a later change to
        # what else the bot says must not rewrite it. Nothing follows them
        # today — a run that walks off the end of its graph finishes and the
        # bot says nothing more (`dispatch` has no safety-net menu any more).
        self.assertEqual(
            self.sent_methods(run)[:4], ["sendMessage", "answerCallbackQuery", "deleteMessage", "sendPhoto"]
        )
        self.assertEqual(self.calls(run), ["sendMessage", "sendPhoto"])

    def test_the_old_message_goes_before_the_new_one_arrives(self):
        """Order matters: delete first means the reader never sees both."""
        self.make_pair(transitions.DELETE, self.photo())
        self.tap()

        methods = self.sent_methods(None)
        self.assertLess(methods.index("deleteMessage"), methods.index("sendPhoto"))

    def test_a_delay_sends_first_and_takes_the_old_one_away_behind_it(self):
        self.make_pair(transitions.DELETE, self.photo(), deleteAfterSeconds=5)
        with mock.patch("apps.engine.tasks.delete_message.apply_async") as scheduled:
            run = self.tap()

        self.assertNotIn("deleteMessage", self.sent_methods(run))
        scheduled.assert_called_once()
        self.assertEqual(scheduled.call_args.kwargs["countdown"], 5)
        self.assertEqual(self.calls(run), ["sendMessage", "sendPhoto"])

    def test_a_screen_older_than_telegram_allows_steps_down_instead(self):
        """«A message can only be deleted if it was sent less than 48 hours
        ago.» A flow woken by a Kutish block two days later cannot tidy up after
        itself, and must answer anyway."""
        self.make_pair(transitions.DELETE, self.photo())
        dispatch(self.bot, message_update("/menyu"))
        run = FlowRun.objects.filter(is_test=False).latest("started_at")
        run.context[SCREEN_SENT_AT] = (timezone.now() - timedelta(hours=49)).isoformat()
        run.save(update_fields=["context"])

        dispatch(self.bot, callback_update("btn:b1"))
        run.refresh_from_db()
        self.assertNotIn("deleteMessage", self.sent_methods(run))
        # Stepped sideways onto the mildest thing that still helps.
        self.assertIn("editMessageReplyMarkup", self.sent_methods(run))
        self.assertEqual(self.calls(run), ["sendMessage", "sendPhoto"])

    def test_telegram_refusing_the_delete_still_answers_the_customer(self):
        self.make_pair(transitions.DELETE, self.photo())
        original = TelegramClient.call

        def refuse(client, method, payload=None):
            if method == "deleteMessage":
                raise TelegramError(method, "MESSAGE_DELETE_FORBIDDEN", 400)
            return original(client, method, payload)

        with mock.patch.object(TelegramClient, "call", refuse):
            run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "sendPhoto"])

    def test_an_edit_never_falls_through_to_a_delete(self):
        """The author asked for the transition that keeps the message. Quietly
        destroying it instead is worse than the failure they asked about."""
        self.assertEqual(transitions.FALLBACK[transitions.EDIT], transitions.CLEAR_BUTTONS)
        self.assertEqual(transitions.FALLBACK[transitions.DELETE], transitions.CLEAR_BUTTONS)

    def test_the_delay_is_clamped(self):
        self.assertEqual(transitions.delete_delay({"deleteAfterSeconds": -4}), 0)
        self.assertEqual(transitions.delete_delay({"deleteAfterSeconds": 99999}), transitions.MAX_DELETE_DELAY)
        self.assertEqual(transitions.delete_delay({"deleteAfterSeconds": "bir"}), 0)
        self.assertEqual(transitions.delete_delay(None), 0)

    def test_deleting_is_offered_whatever_the_blocks_are(self):
        """It asks nothing of either side — the only condition is the clock, and
        no pure function knows what time it is."""
        self.assertIn(transitions.DELETE, transitions.available("invoice", False, {"type": "message"}))
        self.assertIn(transitions.DELETE, transitions.available("album", False, {"type": "invoice"}))


class LadderTests(EngineTestCase):
    """What actually goes out, walked end to end from a real update."""

    def make_two_menus(self, transition: str | None = None, second: dict | None = None):
        """A keyboard block whose button leads to a second one — the screenshot's
        shape. The second edge asks to *edit* by default: «Menyu» used to make
        that the automatic behaviour, and now that it is gone the edge says so
        explicitly, so these tests still exercise the edit ladder."""
        edge = {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2",
                "transition": transition if transition is not None else transitions.EDIT}
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Kerakli bo'limni tanlang:",
                    "buttons": [{"id": "b1", "label": "Xizmatlar", "kind": "callback"}],
                },
                second
                or {
                    "id": "m2",
                    "type": "message",
                    "text": "Shifokorlik xizmatlari mavjud",
                    "buttons": [{"id": "b2", "label": "MRT", "kind": "callback"}],
                },
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}, edge],
            name="Menyu",
        )

    def calls(self, run) -> list[str]:
        """Every Bot API method this run has aimed at the customer, in order."""
        return [step.payload.get("method", "") for step in run.steps.filter(actor="bot").order_by("created_at")]

    def last(self, run) -> dict:
        return run.steps.filter(actor="bot").order_by("-created_at").first().payload

    def first_message_id(self, run) -> int:
        """The id Telegram gave the message the run opened with.

        Read back rather than written down: the pointer is what *we* sent, not
        what the customer tapped, because a typed answer carries no keyboard
        for a callback to name and the two have to work the same way.
        """
        return run.steps.filter(actor="bot").order_by("created_at").first().payload["result"]["message_id"]

    def tap(self):
        dispatch(self.bot, message_update("/menyu"))
        return FlowRun.objects.get(pk=dispatch(self.bot, callback_update("btn:b1"))["runId"])

    def test_a_menu_now_replaces_the_menu_before_it(self):
        """The screenshot that started this: three taps left six bubbles."""
        self.make_two_menus()
        run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "editMessageText"])
        payload = self.last(run)["payload"]
        self.assertEqual(payload["text"], "Shifokorlik xizmatlari mavjud")
        self.assertEqual(payload["message_id"], self.first_message_id(run))

    def test_the_edge_can_ask_for_the_old_behaviour_back(self):
        self.make_two_menus(transition=transitions.KEEP)
        run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "sendMessage"])

    def test_clearing_the_buttons_strips_the_old_keyboard_then_sends(self):
        self.make_two_menus(transition=transitions.CLEAR_BUTTONS)
        run = self.tap()

        # The strip is not a step of its own — nothing was said to the customer
        # — so what the trace shows is the send that followed it.
        self.assertEqual(self.calls(run), ["sendMessage", "sendMessage"])
        self.assertEqual(self.last(run)["transition"], transitions.CLEAR_BUTTONS)

    def test_an_edit_the_matrix_forbids_falls_back_to_a_send(self):
        """An author may ask for a transition the blocks cannot support — or
        change the second block to a poll long after wiring the line. What
        must not change is that the message goes out."""
        self.make_two_menus(
            transition=transitions.EDIT,
            second={"id": "m2", "type": "message", "contentKind": "poll",
                    "poll": {"question": "Qaysi biri?", "options": [{"id": "o1", "text": "MRT"}]}},
        )
        run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "sendPoll"])

    def test_a_reply_keyboard_falls_back_to_a_send(self):
        self.make_two_menus(
            transition=transitions.EDIT,
            second={"id": "m2", "type": "message", "text": "Tanlang", "buttonMode": "reply",
                    "buttons": [{"id": "b2", "label": "MRT", "kind": "callback"}]},
        )
        run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "sendMessage"])

    def test_a_greeting_survives_the_menu_that_follows_it(self):
        """`/start` → hello → menu, which is what the starter graph builds.

        The menu must land *under* the greeting. Replacing it would delete the
        bot's own hello, which is what the first version of this default did on
        a live bot before anyone had tapped anything.
        """
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {"id": "n2", "type": "message", "text": "Assalomu alaykum!"},
                {"id": "m1", "type": "message", "text": "Kerakli bo'limni tanlang:",
                 "buttons": [{"id": "b1", "label": "Xizmatlar"}]},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "out", "to": "m1"},
            ],
            name="Salom",
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])

        self.assertEqual(self.calls(run), ["sendMessage", "sendMessage"])
        texts = [step.payload["payload"]["text"] for step in run.steps.filter(actor="bot").order_by("created_at")]
        self.assertEqual(texts, ["Assalomu alaykum!", "Kerakli bo'limni tanlang:"])

    def test_the_first_block_of_a_run_has_nothing_to_replace(self):
        self.make_two_menus()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/menyu"))["runId"])

        self.assertEqual(self.calls(run), ["sendMessage"])

    def test_telegram_refusing_the_edit_still_answers_the_customer(self):
        """The property the whole feature rests on. A refused edit must never
        become silence — a customer who taps a button and gets nothing back
        cannot tell a bug from a dead bot."""
        self.make_two_menus()
        original = TelegramClient.call

        def refuse_edits(client, method, payload=None):
            if method.startswith("editMessage"):
                raise TelegramError(method, "MESSAGE_ID_INVALID", 400)
            return original(client, method, payload)

        with mock.patch.object(TelegramClient, "call", refuse_edits):
            run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "sendMessage"])
        self.assertEqual(self.last(run)["payload"]["text"], "Shifokorlik xizmatlari mavjud")

    def test_a_screen_that_already_says_this_is_not_an_error(self):
        """Telegram answers an identical edit with a 400. The screen is already
        correct; there is nothing left to do and nothing to report."""
        self.make_two_menus()
        original = TelegramClient.call

        def unchanged(client, method, payload=None):
            if method.startswith("editMessage"):
                raise TelegramError(method, "Bad Request: message is not modified", 400)
            return original(client, method, payload)

        with mock.patch.object(TelegramClient, "call", unchanged):
            run = self.tap()

        self.assertEqual(self.calls(run), ["sendMessage", "editMessageText"])
        self.assertEqual(run.status, FlowRun.Status.WAITING)

    def test_the_pointer_follows_the_edit_rather_than_the_send(self):
        """Two taps in a row edit the same message: an edit does not mint a new
        id, so the second transition has to address the first one's target."""
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {"id": "m1", "type": "message", "text": "Bir", "buttons": [{"id": "b1", "label": "Ikki"}]},
                {"id": "m2", "type": "message", "text": "Ikki", "buttons": [{"id": "b2", "label": "Uch"}]},
                {"id": "m3", "type": "message", "text": "Uch", "buttons": [{"id": "b3", "label": "Yana"}]},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2", "transition": transitions.EDIT},
                {"id": "e3", "from": "m2", "port": "btn:b2", "to": "m3", "transition": transitions.EDIT},
            ],
            name="Menyu",
        )
        dispatch(self.bot, message_update("/menyu"))
        dispatch(self.bot, callback_update("btn:b1"))
        run = FlowRun.objects.get(pk=dispatch(self.bot, callback_update("btn:b2"))["runId"])

        self.assertEqual(self.calls(run), ["sendMessage", "editMessageText", "editMessageText"])
        self.assertEqual(self.last(run)["payload"]["message_id"], self.first_message_id(run))
        self.assertEqual(self.last(run)["payload"]["text"], "Uch")

    def test_a_test_run_reaches_no_chat_and_still_names_its_transition(self):
        """The editor's test chat drives this same code and must send nothing.
        It still has to know what the transition would have been, or the author
        is testing a bot that behaves differently from theirs."""
        self.make_two_menus()
        flow = Flow.objects.get(name="Menyu")
        run = start_run(flow=flow, contact=None, entry_node_id="m1", is_test=True)

        self.assertTrue(self.last(run)["preview"])
        # Nothing has been sent yet, so there is no screen to replace — the same
        # answer a real run gives on its first block.
        self.assertEqual(self.last(run)["transition"], transitions.KEEP)
