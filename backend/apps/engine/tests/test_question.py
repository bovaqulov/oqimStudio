"""«Savol berish»: ask, wait, keep.

The block exists because of a bug nothing else in this suite could have caught.
An author wrote what every author writes — a «Xabar» saying "ism va
familiyangizni yozing", and a «Ma'lumotni saqlash» block after it set to
`mijoz_ismi = {{message.text}}` — and the runtime walked straight through both
without stopping. `{{message.text}}` still held the *previous* message, so a
real contact was saved as `mijoz_ismi = "Shifokorga yozilish"`: the label of the
inline button they had pressed a moment earlier.

Every test here is a shape of that failure, on the graph that produced it: a
command, a menu, a question behind one of its buttons, and a thank-you that
reads the answer back. `test_the_answer_and_not_the_message_before_it` is the
one that was actually observed, in a customer record.
"""

from .base import *  # noqa: F401,F403


class QuestionBlockTests(EngineTestCase):
    """Asking for something and keeping what comes back."""

    def make_question_flow(self, **question):
        """/ariza → a menu → a question → a thank-you that reads the answer back."""
        node = {
            "id": "q1",
            "type": "question",
            "text": "Ism va familiyangizni yozing:",
            "saveAnswerAs": "mijoz_ismi",
            **question,
        }
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "ariza"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Bo'limni tanlang:",
                    "buttons": [{"id": "b1", "label": "Shifokorga yozilish", "kind": "callback"}],
                },
                node,
                {"id": "t1", "type": "message", "text": "Rahmat, {{mijoz_ismi}}!"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "q1"},
                {"id": "e3", "from": "q1", "port": "out", "to": "t1"},
            ],
        )

    def run_of(self, flow):
        return FlowRun.objects.filter(flow=flow).order_by("-started_at").first()

    def test_the_question_waits_instead_of_walking_on(self):
        """The whole of it. A «Xabar» here would already be at the next block."""
        flow = self.make_question_flow()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))

        run = self.run_of(flow)
        self.assertEqual(run.status, FlowRun.Status.WAITING)
        self.assertEqual(run.current_node_id, "q1")

    def test_the_answer_and_not_the_message_before_it(self):
        """The reported bug, as data.

        Before the block existed this stored "Shifokorga yozilish" — the button
        label — because the save ran in the same walk as the question and
        `{{message.text}}` had not moved on yet.
        """
        flow = self.make_question_flow()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("Bovaqulov Muhammadali"))

        contact = Contact.objects.get(telegram_user_id=555)
        self.assertEqual(contact.variables["mijoz_ismi"], "Bovaqulov Muhammadali")
        self.assertEqual(self.run_of(flow).context["mijoz_ismi"], "Bovaqulov Muhammadali")

    def test_the_next_block_can_read_the_answer_back(self):
        flow = self.make_question_flow()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("Bovaqulov Muhammadali"))

        said = [step.text for step in self.run_of(flow).steps.filter(actor="bot")]
        self.assertIn("Rahmat, Bovaqulov Muhammadali!", said)

    def test_the_run_carries_on_once_it_is_answered(self):
        flow = self.make_question_flow()
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("Bovaqulov Muhammadali"))

        self.assertEqual(self.run_of(flow).status, FlowRun.Status.DONE)

    def test_an_answer_of_the_wrong_kind_is_asked_for_again(self):
        flow = self.make_question_flow(answerType="phone", saveAnswerAs="mijoz_telefoni")
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("salom men raqam emasman"))

        run = self.run_of(flow)
        self.assertEqual(run.status, FlowRun.Status.WAITING)
        self.assertEqual(run.current_node_id, "q1")
        self.assertNotEqual(run.context.get("mijoz_telefoni"), "salom men raqam emasman")

    def test_a_phone_number_is_stored_in_one_shape_however_it_was_typed(self):
        flow = self.make_question_flow(answerType="phone", saveAnswerAs="mijoz_telefoni")
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("90 123 45 67"))

        self.assertEqual(self.run_of(flow).context["mijoz_telefoni"], "+998901234567")

    def test_the_authors_own_wording_replaces_the_built_in_refusal(self):
        flow = self.make_question_flow(
            answerType="phone", saveAnswerAs="mijoz_telefoni", errorText="Raqamni +998 bilan yozing."
        )
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("yo'q"))

        said = [step.text for step in self.run_of(flow).steps.all()]
        self.assertIn("Raqamni +998 bilan yozing.", said)

    def test_it_gives_up_to_a_person_rather_than_arguing(self):
        """Three refusals and the conversation stops being a robot's."""
        flow = self.make_question_flow(answerType="phone", saveAnswerAs="mijoz_telefoni", retryLimit=3)
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        for _ in range(3):
            dispatch(self.bot, message_update("hali ham raqam emas"))

        self.assertEqual(self.run_of(flow).status, FlowRun.Status.HANDOFF)

    def test_the_count_of_refusals_belongs_to_one_question(self):
        """A wrong answer, then a right one — the next question starts clean."""
        flow = self.make_question_flow(answerType="phone", saveAnswerAs="mijoz_telefoni")
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("emas"))
        dispatch(self.bot, message_update("+998901234567"))

        run = self.run_of(flow)
        self.assertNotIn("_answer_attempts", run.context)
        self.assertEqual(run.context["mijoz_telefoni"], "+998901234567")

    def test_a_question_with_nowhere_to_save_still_answers_the_flow(self):
        """No variable named is a question asked for the sake of the branch after it."""
        flow = self.make_question_flow(saveAnswerAs="")
        dispatch(self.bot, message_update("/ariza"))
        dispatch(self.bot, callback_update("btn:b1"))
        dispatch(self.bot, message_update("Bovaqulov Muhammadali"))

        run = self.run_of(flow)
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(run.context["message.text"], "Bovaqulov Muhammadali")
