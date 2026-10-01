"""One class per block type: language, follow-up, end, and the keyboard rules.

«Invoys» is no longer a block an author can add, but a graph saved while it was
one still says `message` + `contentKind: "invoice"` and the runtime still sends
it — which is what `InvoiceTests` drives.
"""

from django.test import override_settings

from .base import *  # noqa: F401,F403


class InvoiceTests(EngineTestCase):
    """Taking money: the invoice, the approval, and the branch after it."""

    def _revenue(self):
        from apps.analytics.models import Event

        return Event.objects.filter(metric="revenue").first()

    def test_a_currency_with_subunits_is_recorded_in_whole_units(self):
        self.make_shop(currency="UZS")
        dispatch(self.bot, message_update("/buy"))
        dispatch(self.bot, payment_update(total=5000, currency="UZS"))

        row = self._revenue()
        self.assertEqual(float(row.value), 50.0)

    def test_stars_revenue_is_not_divided_by_a_subunit_they_do_not_have(self):
        """Seven stars are seven — not seven hundredths.

        `sender.build_call` already knew `XTR` has no subunit on the way out;
        `dispatch` did not on the way back, so every Stars sale was recorded at
        a hundredth of what it earned. The two ends of one currency's
        arithmetic have to agree, which is the whole point of this test.
        """
        self.make_shop(currency="XTR", amount="7")
        dispatch(self.bot, message_update("/buy"))
        dispatch(self.bot, payment_update(total=7, currency="XTR"))

        row = self._revenue()
        self.assertEqual(float(row.value), 7.0)
        self.assertEqual(row.currency, "XTR")

    def make_shop(self, currency: str = "UZS", **invoice) -> None:
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "buy"}},
                {
                    "id": "n2",
                    "type": "message",
                    "contentKind": "invoice",
                    "text": "",
                    "invoice": {
                        "title": "Kurs",
                        "description": "Bir oylik kurs",
                        "amount": "50",
                        "currency": currency,
                        **invoice,
                    },
                },
                {"id": "ok", "type": "message", "text": "Rahmat, to'lov qabul qilindi!"},
                {"id": "no", "type": "message", "text": "Bekor qilindi."},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "paid", "to": "ok"},
                {"id": "e3", "from": "n2", "port": "cancelled", "to": "no"},
            ],
        )

    def sent_invoice(self, run) -> dict:
        step = run.steps.filter(actor="bot").order_by("-created_at").first()
        return step.payload["payload"]

    def test_the_invoice_is_sent_with_a_pay_button_in_front(self):
        self.make_shop()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/buy"))["runId"])

        payload = self.sent_invoice(run)
        self.assertEqual(payload["currency"], "UZS")
        # 50 so'm, in the smallest unit Telegram counts in.
        self.assertEqual(payload["prices"][0]["amount"], 5000)
        self.assertTrue(payload["reply_markup"]["inline_keyboard"][0][0]["pay"])

    def test_stars_are_whole_units_and_need_no_merchant_token(self):
        self.make_shop(currency="XTR", amount="7")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/buy"))["runId"])

        payload = self.sent_invoice(run)
        self.assertEqual(payload["currency"], "XTR")
        self.assertEqual(payload["prices"][0]["amount"], 7, "XTR has no subunit — 7 stars is 7")
        self.assertEqual(payload["provider_token"], "")

    def test_a_card_invoice_bills_through_the_provider_the_block_names(self):
        PaymentConnection.objects.create(bot=self.bot, provider_id="click", token="CLICK-TOKEN")
        PaymentConnection.objects.create(bot=self.bot, provider_id="payme", token="PAYME-TOKEN")
        self.make_shop(providerId="payme")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/buy"))["runId"])

        self.assertEqual(self.sent_invoice(run)["provider_token"], "PAYME-TOKEN")

    def test_the_run_waits_on_the_invoice_rather_than_walking_past_it(self):
        self.make_shop()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/buy"))["runId"])

        self.assertEqual(run.status, FlowRun.Status.WAITING)
        self.assertEqual(run.current_node_id, "n2")

    def test_the_pre_checkout_query_is_approved(self):
        self.make_shop()
        dispatch(self.bot, message_update("/buy"))

        with mock.patch("apps.engine.dispatch.client_for") as client_for:
            result = dispatch(self.bot, pre_checkout_update())

        self.assertEqual(result["reason"], "pre_checkout_ok")
        client_for.return_value.answer_pre_checkout_query.assert_called_once_with("pc1", ok=True)

    def test_money_landing_continues_through_the_paid_branch(self):
        self.make_shop()
        started = dispatch(self.bot, message_update("/buy"))

        result = dispatch(self.bot, payment_update())

        self.assertEqual(result["reason"], "resumed")
        run = FlowRun.objects.get(pk=started["runId"])
        self.assertIn("Rahmat", run.steps.filter(actor="bot").order_by("-created_at").first().text)

    def test_a_tapped_cancel_button_takes_the_other_branch(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "buy2"}},
                {
                    "id": "n2",
                    "type": "message",
                    "contentKind": "invoice",
                    "invoice": {"title": "Kurs", "description": "d", "amount": "50", "currency": "UZS"},
                    "buttons": [{"id": "b1", "label": "Bekor qilish", "kind": "callback"}],
                },
                {"id": "no", "type": "message", "text": "Bekor qilindi."},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "btn:b1", "to": "no"},
            ],
            name="Bekor",
        )
        started = dispatch(self.bot, message_update("/buy2"))
        run = FlowRun.objects.get(pk=started["runId"])
        rows = run.steps.filter(actor="bot").order_by("-created_at").first().payload["payload"]["reply_markup"]["inline_keyboard"]
        self.assertTrue(rows[0][0]["pay"], "the Pay button still comes first")
        self.assertEqual(rows[1][0]["callback_data"], "btn:b1")

        dispatch(self.bot, callback_update("btn:b1"))

        run.refresh_from_db()
        self.assertIn("Bekor qilindi", run.steps.filter(actor="bot").order_by("-created_at").first().text)

    def test_the_invoice_always_offers_a_way_out(self):
        self.make_shop()
        started = dispatch(self.bot, message_update("/buy"))
        run = FlowRun.objects.get(pk=started["runId"])
        rows = self.sent_invoice(run)["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[-1][0]["callback_data"], "port:cancelled")

        dispatch(self.bot, callback_update("port:cancelled"))

        run.refresh_from_db()
        self.assertIn("Bekor qilindi", run.steps.filter(actor="bot").order_by("-created_at").first().text)

    def test_a_customer_who_backs_out_of_an_unwired_invoice_is_not_left_parked(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "buy4"}},
                {
                    "id": "n2",
                    "type": "invoice",
                    "invoice": {"title": "Kurs", "description": "d", "amount": "9", "currency": "XTR"},
                },
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "n2"}],
            name="Chiqishsiz",
        )
        started = dispatch(self.bot, message_update("/buy4"))

        dispatch(self.bot, callback_update("port:cancelled"))

        run = FlowRun.objects.get(pk=started["runId"])
        self.assertEqual(run.status, FlowRun.Status.DONE, "no branch drawn, but the run still ends")

class LanguageTests(EngineTestCase):
    """Ask, store, continue — and never offer a language the bot cannot speak."""

    def make_picker(self, options=None) -> None:
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "til"}},
                {
                    "id": "l1",
                    "type": "language",
                    "text": "Tilni tanlang:",
                    "language": {
                        "options": options
                        if options is not None
                        else [
                            {"id": "o1", "code": "uz", "label": "O'zbekcha"},
                            {"id": "o2", "code": "ru", "label": "Ruscha"},
                            {"id": "o3", "code": "en", "label": "English"},
                        ]
                    },
                },
                {"id": "end", "type": "message", "text": "Davom etamiz."},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "l1"},
                {"id": "e2", "from": "l1", "port": "out", "to": "end"},
            ],
            name="Til",
        )

    def keyboard(self, run):
        step = run.steps.filter(actor="bot").order_by("created_at").first()
        return step.payload["payload"]["reply_markup"]["inline_keyboard"]

    def test_only_the_languages_the_bot_speaks_are_offered(self):
        # The bot's own setting has the last word: a button for a language
        # nobody wrote any text in writes `mijoz_tili` and changes nothing else.
        self.assertEqual(self.bot.languages["enabled"], ["uz", "ru"])
        self.make_picker()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/til"))["runId"])

        rows = self.keyboard(run)
        self.assertEqual([row[0]["callback_data"] for row in rows], ["lang:uz", "lang:ru"])

    def test_a_block_that_lists_none_falls_back_to_the_bots_own_list(self):
        self.make_picker(options=[])
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/til"))["runId"])

        rows = self.keyboard(run)
        self.assertEqual([row[0]["text"] for row in rows], ["🇺🇿 O'zbekcha", "🇷🇺 Русский"])

    def test_the_choice_lands_on_the_contact_and_the_flow_continues(self):
        self.make_picker()
        started = dispatch(self.bot, message_update("/til"))

        dispatch(self.bot, callback_update("lang:ru"))

        run = FlowRun.objects.get(pk=started["runId"])
        contact = Contact.objects.get(bot=self.bot, telegram_user_id=555)
        self.assertEqual(contact.variables["mijoz_tili"], "ru")
        self.assertEqual(contact.language, "ru", "the whole point: everything downstream reads this one name")
        self.assertEqual(run.steps.filter(actor="bot").order_by("-created_at").first().text, "Davom etamiz.")


class FollowupTests(EngineTestCase):
    """The reminder that does not stop the flow."""

    def setUp(self) -> None:
        super().setUp()
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "m1", "type": "message", "text": "690 000 so'm."},
                {"id": "f1", "type": "followup", "minutes": 45, "text": "Hali javob kutyapmiz 🙂"},
                {"id": "m2", "type": "message", "text": "Savolingiz bo'lsa yozing."},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "out", "to": "f1"},
                {"id": "e3", "from": "f1", "port": "out", "to": "m2"},
            ],
            name="Follow-up",
        )

    def start(self):
        with mock.patch("apps.engine.tasks.send_followup.apply_async") as scheduled:
            result = dispatch(self.bot, message_update("/narx"))
        return FlowRun.objects.get(pk=result["runId"]), scheduled

    def armed_at(self, run):
        step = run.steps.filter(node_id="f1", actor="system").order_by("created_at").first()
        return parse_datetime(step.payload["armedAt"])

    def test_the_flow_walks_straight_past_the_block(self):
        run, scheduled = self.start()

        self.assertEqual(run.status, FlowRun.Status.DONE, "unlike Kutish, nothing is parked")
        self.assertEqual(run.steps.filter(actor="bot").order_by("-created_at").first().text, "Savolingiz bo'lsa yozing.")
        self.assertEqual(scheduled.call_args.kwargs["countdown"], 45 * 60)
        self.assertEqual(scheduled.call_args.kwargs["args"][:2], [run.id, "f1"])

    def test_the_reminder_goes_out_when_the_customer_has_gone_quiet(self):
        from apps.engine.runner import deliver_followup

        run, _ = self.start()

        self.assertEqual(deliver_followup(run, "f1", self.armed_at(run)), "sent")
        self.assertEqual(run.steps.filter(actor="bot").order_by("-created_at").first().text, "Hali javob kutyapmiz 🙂")

    def test_a_customer_who_answered_is_not_reminded(self):
        from apps.engine.runner import deliver_followup

        run, _ = self.start()
        armed_at = self.armed_at(run)
        contact = Contact.objects.get(bot=self.bot, telegram_user_id=555)
        contact.last_seen_at = armed_at + timedelta(minutes=5)
        contact.save(update_fields=["last_seen_at"])

        self.assertEqual(deliver_followup(run, "f1", armed_at), "answered")
        self.assertEqual(
            run.steps.filter(actor="bot").order_by("-created_at").first().text,
            "Savolingiz bo'lsa yozing.",
            "the last thing sent is still the flow's own message",
        )

    def test_a_test_run_arms_nothing(self):
        from apps.engine.runner import start_run

        flow = Flow.objects.get(name="Follow-up")
        with mock.patch("apps.engine.tasks.send_followup.apply_async") as scheduled:
            start_run(flow=flow, entry_node_id="c1", is_test=True)

        scheduled.assert_not_called()


class EndBlockTests(EngineTestCase):
    """«Tugatish»: the block an author drops where the conversation is over.

    It publishes no exit, so there is nothing here about what leaves it. What is
    asserted is the ending — that the run is finished rather than left parked,
    that nothing beyond the block runs, and that the customer is left exactly
    where the end of a graph would have left them. That last one is the point of
    the block being a marker rather than a behaviour: an ending the author drew
    and an ending they let the graph run into have to be the same ending.
    """

    def make_farewell(self, *, stale_exit: bool = False) -> None:
        edges = [
            {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
            {"id": "e2", "from": "m1", "port": "out", "to": "x1"},
        ]
        if stale_exit:
            # An edge leaving a port this block never published. The editor
            # cannot draw one — the card has no dot to drag from — but a graph
            # written through the API, or converted out of another block type,
            # can carry one, and following it would walk past the full stop.
            edges.append({"id": "e3", "from": "x1", "port": "out", "to": "m2"})
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "rahmat"}},
                {"id": "m1", "type": "message", "text": "Buyurtmangiz qabul qilindi."},
                {"id": "x1", "type": "end", "text": "Suhbat shu blokda tugaydi"},
                {"id": "m2", "type": "message", "text": "Bu xabar hech qachon ketmasligi kerak."},
            ],
            edges,
            name="Xayrlashuv",
        )

    def start(self) -> FlowRun:
        return FlowRun.objects.get(pk=dispatch(self.bot, message_update("/rahmat"))["runId"])

    def test_the_run_finishes_on_the_block(self):
        self.make_farewell()

        run = self.start()

        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertFalse(run.is_parked, "an ending is not a block waiting for something")
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(run.current_node_id, "", "nothing is left to resume from")

    def test_the_flow_still_says_what_it_had_to_say_first(self):
        self.make_farewell()

        said = [step.text for step in self.start().steps.filter(actor="bot")]

        self.assertEqual(said, ["Buyurtmangiz qabul qilindi."])

    def test_nothing_wired_past_it_runs(self):
        self.make_farewell(stale_exit=True)

        said = [step.text for step in self.start().steps.filter(actor="bot")]

        self.assertEqual(said, ["Buyurtmangiz qabul qilindi."], "the walk stops at the block, not at its edges")

    def test_the_trail_names_where_the_conversation_stopped(self):
        self.make_farewell()

        last = self.start().steps.order_by("-created_at").first()

        self.assertEqual(last.node_type, "end")
        self.assertEqual(last.node_id, "x1")
        self.assertEqual(last.actor, "system", "the block sends nothing of its own")

    def test_a_tap_that_lands_on_the_block_ends_the_conversation(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "anketa"}},
                {
                    "id": "m1",
                    "type": "message",
                    "text": "Davom etamizmi?",
                    "buttons": [{"id": "b1", "label": "Ha", "kind": "callback"}],
                },
                {"id": "x1", "type": "end"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "x1"},
            ],
            name="Anketa",
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/anketa"))["runId"])
        self.assertEqual(run.status, FlowRun.Status.WAITING, "a keyboard parks, as it always does")

        dispatch(self.bot, callback_update("btn:b1"))

        run.refresh_from_db()
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(run.steps.order_by("-created_at").first().node_type, "end")

    def test_the_customer_is_left_where_the_end_of_a_graph_would_leave_them(self):
        self.make_farewell()
        run = self.start()

        # Both endings are the same ending, and neither adds a word: the block
        # says what its author wrote and the conversation stops there. The
        # after-flow menu that used to follow was part of the bot's «Javoblar»
        # settings, and those are gone.
        said = [step.text for step in run.steps.filter(actor="bot").order_by("created_at")]
        self.assertEqual(said, ["Buyurtmangiz qabul qilindi."])
        self.assertEqual(run.status, FlowRun.Status.DONE)


class UnknownBlockTests(EngineTestCase):
    """A block type this deployment does not know must not reach the customer."""

    def test_it_is_stepped_over_rather_than_sent(self):
        """It used to fall through to `_handle_message` and mail its own text out.

        Graphs arrive from templates and the API as well as from the editor, so
        a type added on one side and forgotten here was one save away from
        sending an internal label to a paying customer.
        """
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "x"}},
                {"id": "n2", "type": "kelajakdagi_blok", "text": "ICHKI YOZUV — mijoz buni ko'rmasin"},
                {"id": "n3", "type": "message", "text": "Davomi"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "out", "to": "n3"},
            ],
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/x"))["runId"])

        sent = [step.payload.get("payload", {}) for step in run.steps.filter(actor="bot")]
        texts = " ".join(str(payload.get("text", "")) for payload in sent)
        self.assertNotIn("ICHKI YOZUV", texts)
        # And the walk did not stop at it — the block after it still ran.
        self.assertIn("Davomi", texts)

    def test_the_trail_says_it_was_skipped(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "y"}},
                {"id": "n2", "type": "kelajakdagi_blok", "text": "x"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "n2"}],
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/y"))["runId"])

        systems = " ".join(step.text for step in run.steps.filter(actor="system"))
        self.assertIn("kelajakdagi_blok", systems)


class RequestButtonTests(EngineTestCase):
    """`request_contact` / `request_location` — the reply keyboard's share rows."""

    def _graph(self, *, mode: str = "reply"):
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "aloqa"}},
                {
                    "id": "n2",
                    "type": "message",
                    "text": "Qanday bog'lanamiz?",
                    "buttonMode": mode,
                    "buttons": [
                        {"id": "b1", "label": "📱 Raqamni yuborish", "kind": "request_contact"},
                        {"id": "b2", "label": "Boshqa yo'l", "kind": "callback"},
                    ],
                },
                {"id": "n3", "type": "message", "text": "Raqam qabul qilindi: {{xabar}}"},
                {"id": "n4", "type": "message", "text": "Operator yozadi"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "btn:b1", "to": "n3"},
                {"id": "e3", "from": "n2", "port": "btn:b2", "to": "n4"},
            ],
        )

    def _keyboard(self, run) -> dict:
        step = run.steps.filter(actor="bot", node_id="n2").get()
        return step.payload.get("payload", {}).get("reply_markup", {})

    def test_the_request_row_carries_its_flag(self):
        self._graph()
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/aloqa"))["runId"])

        markup = self._keyboard(run)
        self.assertIn("keyboard", markup, "a share row exists only on a reply keyboard")
        flags = {row[0]["text"]: row[0].get("request_contact") for row in markup["keyboard"]}
        self.assertTrue(flags["📱 Raqamni yuborish"])
        self.assertIsNone(flags["Boshqa yo'l"], "an ordinary row carries no request flag")

    def test_a_request_kind_forces_the_keyboard_reply(self):
        # The author (or an older save) says inline; the share row cannot ride
        # one, and degrading it to a callback would send a button that promises
        # a number and delivers nothing.
        self._graph(mode="inline")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/aloqa"))["runId"])

        self.assertIn("keyboard", self._keyboard(run))

    def test_the_share_continues_through_the_request_buttons_branch(self):
        self._graph()
        dispatch(self.bot, message_update("/aloqa"))
        result = dispatch(self.bot, contact_share_update())

        self.assertEqual(result["reason"], "resumed", "the share answers the parked keyboard")
        run = FlowRun.objects.get(pk=result["runId"])
        texts = " ".join(step.text for step in run.steps.filter(actor="bot"))
        self.assertIn("Raqam qabul qilindi", texts)
        self.assertNotIn("Operator yozadi", texts, "the other branch stayed unwalked")
        # And the number itself was filed on the person, same as a question's.
        contact = Contact.objects.get(telegram_user_id=555)
        self.assertEqual(contact.phone, "+998901112233")


    def test_taps_route_even_when_the_stored_mode_says_inline(self):
        # A graph saved as inline while carrying a share row is *sent* as a
        # reply keyboard — so routing has to read the keyboard the customer
        # actually sees, not the stored field. Before `effective_button_mode`
        # both branches of such a node were dead: the share landed in the
        # fallback and the run stayed parked forever.
        self._graph(mode="inline")
        dispatch(self.bot, message_update("/aloqa"))

        shared = dispatch(self.bot, contact_share_update())
        self.assertEqual(shared["reason"], "resumed", "the share answers the keyboard that was sent")
        run = FlowRun.objects.get(pk=shared["runId"])
        texts = " ".join(step.text for step in run.steps.filter(actor="bot"))
        self.assertIn("Raqam qabul qilindi", texts)

    def test_the_shared_number_is_what_the_next_block_reads_back(self):
        # The tap leaves through the button's port, but what it *delivered* is a
        # phone number — so `{{xabar}}` is the number and not the row's label.
        # The two are told apart by whether the update said anything the row did
        # not: an ordinary button sends back its own label and nothing else.
        self._graph()
        dispatch(self.bot, message_update("/aloqa"))
        run = FlowRun.objects.get(pk=dispatch(self.bot, contact_share_update())["runId"])

        self.assertIn(
            "Raqam qabul qilindi: +998901112233",
            " ".join(step.text for step in run.steps.filter(actor="bot")),
        )

    def test_a_typed_label_routes_on_the_forced_reply_keyboard_too(self):
        self._graph(mode="inline")
        dispatch(self.bot, message_update("/aloqa"))

        # The ordinary button on that keyboard comes back as its label text.
        tapped = dispatch(self.bot, message_update("Boshqa yo'l"))
        self.assertEqual(tapped["reason"], "resumed")
        run = FlowRun.objects.get(pk=tapped["runId"])
        self.assertIn("Operator yozadi", " ".join(step.text for step in run.steps.filter(actor="bot")))


class TappedButtonTests(EngineTestCase):
    """What a tap on one of the author's buttons is written down as.

    An inline keyboard reports nothing but the callback data, so the only thing
    that arrives with the tap is `btn:b1` — the wire's name for the port. The
    runtime used to file that as what the customer said: it went into the trace
    an author reads, into `{{xabar}}`, and out again through any block echoing
    it. A reply keyboard sends the row's label instead, so the same tap read two
    ways depending on a keyboard setting the customer cannot see.
    """

    def _flow(self, *, mode="inline"):
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "menyu"}},
                {
                    "id": "n2",
                    "type": "message",
                    "text": "Tanlang:",
                    "buttonMode": mode,
                    "buttons": [{"id": "b1", "label": "Narxlar", "kind": "callback"}],
                },
                {"id": "n3", "type": "message", "text": "Siz «{{xabar}}» ni tanladingiz"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "btn:b1", "to": "n3"},
            ],
        )

    def test_an_inline_tap_reads_back_as_the_row_the_customer_pressed(self):
        self._flow()
        dispatch(self.bot, message_update("/menyu"))
        run = FlowRun.objects.get(pk=dispatch(self.bot, callback_update("btn:b1"))["runId"])

        self.assertIn("Narxlar", [step.text for step in run.steps.filter(actor="user")])
        self.assertIn(
            "Siz «Narxlar» ni tanladingiz",
            " ".join(step.text for step in run.steps.filter(actor="bot")),
        )

    def test_a_reply_tap_reads_back_the_same_way(self):
        # The point of the pair: one keyboard setting, two kinds of update, and
        # the customer meant the same thing by both.
        self._flow(mode="reply")
        dispatch(self.bot, message_update("/menyu"))
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("Narxlar"))["runId"])

        self.assertIn("Narxlar", [step.text for step in run.steps.filter(actor="user")])
        self.assertIn(
            "Siz «Narxlar» ni tanladingiz",
            " ".join(step.text for step in run.steps.filter(actor="bot")),
        )


class ButtonStyleTests(EngineTestCase):
    """Bot API 9.4's `style` — the three colors, and nothing else on the wire."""

    #: One command per keyboard, or a test's second flow answers its first's trigger.
    _commands = itertools.count(1)

    def _run(self, buttons, *, mode: str = "inline"):
        command = f"rang{next(self._commands)}"
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": command}},
                {"id": "n2", "type": "message", "text": "Tanlang", "buttonMode": mode, "buttons": buttons},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "n2"}],
            name=command,
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update(f"/{command}"))["runId"])
        return run.steps.filter(actor="bot", node_id="n2").get().payload.get("payload", {}).get("reply_markup", {})

    def test_a_styled_button_carries_its_color_on_both_keyboards(self):
        inline = self._run([{"id": "b1", "label": "Ha", "kind": "callback", "style": "success"}])
        self.assertEqual(inline["inline_keyboard"][0][0].get("style"), "success")

        reply = self._run([{"id": "b1", "label": "Yo'q", "kind": "callback", "style": "danger"}], mode="reply")
        self.assertEqual(reply["keyboard"][0][0].get("style"), "danger")

    def test_no_style_and_a_broken_style_are_both_omitted(self):
        # "If omitted, then an app-specific style is used" — and an unknown
        # value is sent as omitted rather than as itself, because Telegram
        # refuses the whole message over it.
        markup = self._run(
            [
                {"id": "b1", "label": "Oddiy", "kind": "callback"},
                {"id": "b2", "label": "Buzuq", "kind": "callback", "style": "rainbow"},
            ],
        )
        for row in markup["inline_keyboard"]:
            self.assertNotIn("style", row[0])


class BackRowTests(EngineTestCase):
    """The block's own «Orqaga» row — optional, last, and its own exit."""

    def _flow(self, *, mode: str = "inline", buttons=None, back="", command="menyu"):
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": command}},
                {
                    "id": "n2",
                    "type": "message",
                    "text": "Bo'limni tanlang",
                    "buttonMode": mode,
                    "buttons": buttons if buttons is not None else [{"id": "b1", "label": "Narxlar", "kind": "callback"}],
                    "back": back,
                },
                {"id": "n3", "type": "message", "text": "Narxlar ro'yxati"},
                {"id": "n4", "type": "message", "text": "Bosh menyuga qaytdik"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "btn:b1", "to": "n3"},
                {"id": "e3", "from": "n2", "port": "back", "to": "n4"},
            ],
            name=command,
        )

    def _markup(self, run):
        return run.steps.filter(actor="bot", node_id="n2").get().payload.get("payload", {}).get("reply_markup", {})

    def test_the_row_is_last_on_an_inline_keyboard(self):
        self._flow(command="a1")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/a1"))["runId"])

        rows = self._markup(run)["inline_keyboard"]
        self.assertEqual(rows[-1][0]["text"], "⬅️ Orqaga", "under the author's own keys, never among them")
        self.assertEqual(rows[-1][0]["callback_data"], "port:back")

    def test_the_row_is_last_on_a_reply_keyboard_and_carries_no_payload(self):
        self._flow(mode="reply", command="a2")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/a2"))["runId"])

        rows = self._markup(run)["keyboard"]
        self.assertEqual(rows[-1][0], {"text": "⬅️ Orqaga"}, "a reply row is text; the label is how a tap is read")

    def test_a_renamed_row_says_what_the_author_wrote(self):
        self._flow(back="Bosh sahifa", command="a3")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/a3"))["runId"])

        self.assertEqual(self._markup(run)["inline_keyboard"][-1][0]["text"], "Bosh sahifa")

    def test_a_block_without_the_row_is_unchanged(self):
        self._flow(back=None, command="a4")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/a4"))["runId"])

        texts = [row[0]["text"] for row in self._markup(run)["inline_keyboard"]]
        self.assertEqual(texts, ["Narxlar"], "absent means no row at all")

    def test_the_tap_continues_through_the_back_port(self):
        self._flow(command="a5")
        dispatch(self.bot, message_update("/a5"))
        result = dispatch(self.bot, callback_update("port:back"))

        self.assertEqual(result["reason"], "resumed")
        run = FlowRun.objects.get(pk=result["runId"])
        sent = " ".join(step.text for step in run.steps.filter(actor="bot"))
        self.assertIn("Bosh menyuga qaytdik", sent)
        self.assertNotIn("Narxlar ro'yxati", sent, "the other branch stayed unwalked")

    def test_the_typed_label_continues_through_it_on_a_reply_keyboard(self):
        self._flow(mode="reply", command="a6")
        dispatch(self.bot, message_update("/a6"))
        result = dispatch(self.bot, message_update("⬅️ Orqaga"))

        self.assertEqual(result["reason"], "resumed")
        run = FlowRun.objects.get(pk=result["runId"])
        self.assertIn("Bosh menyuga qaytdik", " ".join(step.text for step in run.steps.filter(actor="bot")))

    def test_a_block_whose_only_row_is_the_back_row_still_gets_one_and_still_waits(self):
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "a7"}},
                {"id": "n2", "type": "message", "text": "Ma'lumot", "buttons": [], "back": ""},
                {"id": "n4", "type": "message", "text": "Qaytdik"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "n2"},
                {"id": "e3", "from": "n2", "port": "back", "to": "n4"},
            ],
            name="a7",
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/a7"))["runId"])

        markup = self._markup(run)
        self.assertEqual(markup["inline_keyboard"][0][0]["callback_data"], "port:back")
        self.assertEqual(run.status, FlowRun.Status.WAITING, "a row nobody waits for is a row that does nothing")


class AlbumKeyboardTests(EngineTestCase):
    """`sendMediaGroup` takes no `reply_markup` at all — so nothing on it waits.

    An album's buttons have never been sent (`node_buttons` reads the content
    kind), but the «Orqaga» row was asked for separately and parked the run on
    a tap that could not happen: the album went out with no keyboard under it,
    and the block after it was never reached.
    """

    def _flow(self, *, back=None):
        node = {
            "id": "n2",
            "type": "message",
            "contentKind": "album",
            "text": "Rasmlar",
            "album": [
                {"id": "a1", "kind": "photo", "source": {"kind": "url", "value": "https://x/1.jpg"}},
                {"id": "a2", "kind": "photo", "source": {"kind": "url", "value": "https://x/2.jpg"}},
            ],
        }
        if back is not None:
            node["back"] = back
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "albom"}},
                node,
                {"id": "n3", "type": "message", "text": "Yoqdimi?"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "n2"},
                {"id": "e2", "from": "n2", "port": "out", "to": "n3"},
            ],
            name="albom",
        )

    def test_an_album_carrying_a_back_row_still_walks_on(self):
        self._flow(back="")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/albom"))["runId"])

        said = " ".join(step.text for step in run.steps.filter(actor="bot"))
        self.assertIn("Yoqdimi?", said, "a row that was never sent cannot be what the run waits for")
        self.assertNotEqual(run.status, FlowRun.Status.WAITING)

    def test_the_album_itself_goes_out_without_a_keyboard(self):
        self._flow(back="")
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/albom"))["runId"])

        sent = run.steps.filter(actor="bot", node_id="n2").first().payload
        self.assertEqual(sent.get("method"), "sendMediaGroup")
        self.assertNotIn("reply_markup", sent.get("payload", {}))


class BusinessReplyRightTests(EngineTestCase):
    """A right the account owner withheld, read before the bot spends a call on it.

    Telegram's own description of the feature (`core.telegram.org/bots/features`,
    "Business Bots") is that the rights "control actions such as replying
    (`can_reply`)" and that "the account owner can specify which chats your bot
    can access". So this is somebody else's switch, in somebody else's app, and
    the only thing this side can do about it is say so instead of failing with
    an API error that names neither.
    """

    def setUp(self) -> None:
        super().setUp()
        from apps.bots.models import BusinessConnection

        self.connection = BusinessConnection.objects.create(
            connection_id="bc1", bot=self.bot, user_chat_id=555, user_name="Aziza",
            rights={"can_reply": True}, is_enabled=True,
        )
        self.flow = self.make_flow(
            [
                {"id": "t1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "start"}},
                {"id": "m1", "type": "message", "title": "Javob", "text": "Assalomu alaykum"},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
        )

    def _run(self, *, connection_id: str = "bc1"):
        """The flow walked once — on a business account, or on an ordinary chat.

        The connection id goes in through `extra_context` rather than being
        written on to the run afterwards. `start_run` walks the graph before it
        returns, so a context edited after that call is an edit to a run that
        has already finished: every block had been delivered without a
        connection id, and the second `walk` this used to do was re-walking a
        completed run. Every assertion below was reading the second walk's
        leftovers rather than the delivery it names.
        """
        from apps.engine.runner import start_run

        extra = {"business_connection_id": connection_id} if connection_id else None
        return start_run(flow=self.flow, entry_node_id="t1", extra_context=extra)

    def sent(self, run) -> bool:
        """Whether the block reached a delivery.

        The «bot» step is written out of what `_deliver` returns, so it exists
        for exactly the deliveries that were attempted: a withheld right raises
        out of `_deliver` first, which leaves the «system» row `walk` writes and
        no «bot» row at all.
        """
        return run.steps.filter(actor="bot").exists()

    def test_with_the_right_the_message_goes_out(self):
        run = self._run()

        self.assertNotEqual(run.status, FlowRun.Status.FAILED, run.error)
        self.assertTrue(self.sent(run), "the block was delivered")

    def test_without_the_right_nothing_is_sent_and_the_trace_says_why(self):
        self.connection.rights = {"can_reply": False}
        self.connection.save(update_fields=["rights"])

        run = self._run()

        self.assertEqual(run.status, FlowRun.Status.FAILED)
        self.assertIn("Javob yozish", run.error)
        self.assertFalse(self.sent(run), "not one call spent on a refusal we could read")

    def test_a_suspended_connection_is_the_same_answer(self):
        """`is_enabled` false is the owner switching the whole connection off.
        Sending into it fails for a different reason and reads the same to the
        author, so it stops at the same place."""
        self.connection.is_enabled = False
        self.connection.save(update_fields=["is_enabled"])

        run = self._run()

        self.assertEqual(run.status, FlowRun.Status.FAILED)
        self.assertFalse(self.sent(run))

    def test_an_unknown_connection_is_left_to_telegram(self):
        """A message that arrived with a connection id this server never stored
        is a shape the guard cannot judge. Refusing it here would invent a rule
        out of a missing row."""
        self.connection.delete()

        run = self._run()

        self.assertNotEqual(run.status, FlowRun.Status.FAILED, run.error)
        self.assertTrue(self.sent(run))

    def test_an_ordinary_chat_is_not_touched_by_any_of_this(self):
        run = self._run(connection_id="")

        self.assertNotEqual(run.status, FlowRun.Status.FAILED, run.error)
        self.assertTrue(self.sent(run))


class TableRowBlockTests(EngineTestCase):
    """«Jadvalga yozish» — the other half of `{{ table("...") }}`.

    What a customer sees is nothing: the block sends no message. What the owner
    sees is a row, which is the whole point — a booking flow's answers were only
    ever readable one contact at a time before this.
    """

    def _table(self, handle="navbat"):
        from apps.tables.models import Table

        return Table.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            name="Navbat",
            handle=handle,
            columns=[
                {"key": "ism", "label": "Ism", "type": "text"},
                {"key": "narx", "label": "Narx", "type": "number"},
            ],
        )

    def _flow(self, table_write):
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "yozil"}},
                {"id": "w1", "type": "tablerow", "title": "Jadvalga yozish",
                 "text": "Javoblarni jadvalga yozadi", "tableWrite": table_write},
                {"id": "m1", "type": "message", "title": "Tasdiq", "text": "Yozildingiz"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "w1"},
                {"id": "e2", "from": "w1", "port": "out", "to": "m1"},
            ],
        )

    def test_it_writes_a_row_and_walks_on(self):
        from apps.tables.models import TableRow

        table = self._table()
        self._flow({"handle": "navbat", "values": {"ism": "{{user.first_name}}", "narx": "150000"}})

        dispatch(self.bot, message_update("/yozil"))

        row = TableRow.objects.get(table=table)
        # The placeholder resolved through the same renderer every other field
        # uses, and the number column took a number rather than a string.
        self.assertEqual(row.data, {"ism": "Dilnoza", "narx": 150000})
        # And the conversation carried on to the block after it.
        run = FlowRun.objects.latest("started_at")
        self.assertEqual([step.text for step in run.steps.filter(actor="bot")], ["Yozildingiz"])

    def test_a_table_that_was_renamed_does_not_stop_the_conversation(self):
        from apps.tables.models import TableRow

        self._table(handle="navbat")
        self._flow({"handle": "eski_nom", "values": {"ism": "{{user.first_name}}"}})

        dispatch(self.bot, message_update("/yozil"))

        self.assertEqual(TableRow.objects.count(), 0)
        run = FlowRun.objects.latest("started_at")
        # The customer still gets the next message; the author gets the reason.
        self.assertEqual([step.text for step in run.steps.filter(actor="bot")], ["Yozildingiz"])
        self.assertTrue(run.steps.filter(actor="system", text__contains="eski_nom").exists())

    def test_a_block_nobody_finished_says_so_and_continues(self):
        self._table()
        self._flow({"handle": "", "values": {}})

        dispatch(self.bot, message_update("/yozil"))

        run = FlowRun.objects.latest("started_at")
        self.assertTrue(run.steps.filter(actor="system", text__contains="Ma'lumot tanlanmagan").exists())
        self.assertEqual(run.status, FlowRun.Status.DONE)

    def test_a_value_the_column_refuses_is_reported_not_raised(self):
        from apps.tables.models import TableRow

        self._table()
        self._flow({"handle": "navbat", "values": {"narx": "bepul"}})

        dispatch(self.bot, message_update("/yozil"))

        self.assertEqual(TableRow.objects.count(), 0)
        run = FlowRun.objects.latest("started_at")
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertTrue(run.steps.filter(actor="system", text__contains="Ma'lumotga yozilmadi").exists())


class TableReadBlockTests(EngineTestCase):
    """«Ma'lumot o'qish» — a lookup, and the branch for when it finds nothing."""

    def setUp(self) -> None:
        super().setUp()
        from apps.tables.models import Table, TableRow

        self.table = Table.objects.create(
            workspace=self.workspace, bot=self.bot, name="Narxlar", handle="narxlar",
            columns=[{"key": "kod", "label": "Kod", "type": "text"},
                     {"key": "narx", "label": "Narx", "type": "number"}],
        )
        TableRow.objects.create(table=self.table, data={"kod": "mrt", "narx": 150000})
        TableRow.objects.create(table=self.table, data={"kod": "uzi", "narx": 250000})

    def _flow(self, read):
        return self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "r1", "type": "tableread", "title": "O'qish", "text": "", "tableRead": read},
                {"id": "ok", "type": "message", "title": "Bor", "text": "Narxi: {{qator.narx}}"},
                {"id": "no", "type": "message", "title": "Yo'q", "text": "Bunday xizmat yo'q"},
            ],
            [
                {"id": "e1", "from": "t1", "port": "out", "to": "r1"},
                {"id": "e2", "from": "r1", "port": "yes", "to": "ok"},
                {"id": "e3", "from": "r1", "port": "no", "to": "no"},
            ],
        )

    def _said(self):
        run = FlowRun.objects.latest("started_at")
        return [step.text for step in run.steps.filter(actor="bot")]

    def test_a_found_row_is_readable_by_column(self):
        self._flow({"handle": "narxlar", "column": "kod", "value": "mrt", "into": "qator"})

        dispatch(self.bot, message_update("/narx"))

        # The row landed under the prefix and the message read one column out
        # of it — the dotted walk `{{http.status}}` already uses.
        self.assertEqual(self._said(), ["Narxi: 150000"])

    def test_nothing_found_takes_the_other_branch(self):
        self._flow({"handle": "narxlar", "column": "kod", "value": "yoq", "into": "qator"})

        dispatch(self.bot, message_update("/narx"))

        self.assertEqual(self._said(), ["Bunday xizmat yo'q"])

    def test_it_compares_as_text_so_a_number_column_still_matches(self):
        """One side came from a customer's keyboard, the other from a number column."""
        self._flow({"handle": "narxlar", "column": "narx", "value": "250000", "into": "qator"})

        dispatch(self.bot, message_update("/narx"))

        self.assertEqual(self._said(), ["Narxi: 250000"])

    def test_no_column_named_reads_the_newest_row(self):
        self._flow({"handle": "narxlar", "column": "", "value": "", "into": "qator"})

        dispatch(self.bot, message_update("/narx"))

        # `-created_at` ordering: the second row written is the one that comes back.
        self.assertEqual(self._said(), ["Narxi: 250000"])

    def test_a_table_that_was_renamed_takes_the_not_found_branch(self):
        self._flow({"handle": "eski_nom", "column": "kod", "value": "mrt", "into": "qator"})

        dispatch(self.bot, message_update("/narx"))

        self.assertEqual(self._said(), ["Bunday xizmat yo'q"])
        run = FlowRun.objects.latest("started_at")
        self.assertTrue(run.steps.filter(actor="system", text__contains="eski_nom").exists())
