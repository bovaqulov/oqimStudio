"""A button the author has not wired must not cost the customer the conversation.

Read from one real chat, in this order:

    10:33:26  btn:…780058   the second button, wired to nothing  → run DONE
    10:33:42  btn:…299545   the first button, wired to a block
    10:35:12  btn:…299545   again
    10:41:29  btn:…299545   again

The last three arrived at the webhook and were all dropped: the run they
belonged to had been finished by the first tap, so nothing was waiting for
them, and a callback opens no new conversation. The bot went silent for the
whole message rather than for the one row, and the owner reported it as "inline
buttons have stopped working".
"""

from .base import *  # noqa: F401,F403


class UnwiredRowTests(EngineTestCase):
    """Two buttons, one of them wired."""

    def make_menu(self):
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "ariza"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Bo'limni tanlang:",
                    "buttons": [
                        {"id": "b1", "label": "Shifokorga yozilish", "kind": "callback"},
                        {"id": "b2", "label": "Tahlil topshirish", "kind": "callback"},
                    ],
                },
                {"id": "m2", "type": "message", "text": "Ism va familiyangizni yozing:"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
            ],
        )

    def run_of(self, flow):
        return FlowRun.objects.filter(flow=flow).order_by("-started_at").first()

    def test_the_wired_row_still_works_after_the_unwired_one_was_pressed(self):
        """The reported failure, end to end."""
        flow = self.make_menu()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b2"))
        dispatch(self.bot, callback_update("btn:b1"))

        said = [step.text for step in self.run_of(flow).steps.filter(actor="bot")]
        self.assertIn("Ism va familiyangizni yozing:", said)

    def test_an_unwired_row_leaves_the_run_on_the_block_that_drew_it(self):
        flow = self.make_menu()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b2"))

        run = self.run_of(flow)
        self.assertEqual(run.status, FlowRun.Status.WAITING)
        self.assertEqual(run.current_node_id, "m1")

    def test_the_tap_is_still_recorded_as_unwired(self):
        """Parking must not cost the author the one line that says why nothing happened."""
        flow = self.make_menu()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b2"))

        said = [step.text for step in self.run_of(flow).steps.filter(actor="system")]
        self.assertIn("Bu javob uchun davomi ulanmagan", said)

    def test_a_command_still_opens_a_fresh_conversation_over_the_parked_run(self):
        """The reason parking is safe: a parked run does not swallow /ariza."""
        flow = self.make_menu()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b2"))
        dispatch(self.bot, message_update("/ariza"))

        self.assertEqual(FlowRun.objects.filter(flow=flow).count(), 2)

    def test_a_block_with_no_keyboard_left_still_ends_the_run(self):
        """The case the original rule was written for, and it is unchanged.

        Nothing is on the customer's screen to press, so an unwired «out» is
        the end of the conversation rather than a row that leads nowhere.
        """
        flow = self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "ariza"}},
                {"id": "q1", "type": "question", "text": "Ismingiz?", "saveAnswerAs": "mijoz_ismi"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "q1"}],
        )
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, message_update("Bovaqulov Muhammadali"))

        self.assertEqual(self.run_of(flow).status, FlowRun.Status.DONE)
