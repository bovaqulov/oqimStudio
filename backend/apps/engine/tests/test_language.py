"""What the bot says when the reader is not speaking the studio's language."""

from .base import *  # noqa: F401,F403


class RuntimeLanguageTests(EngineTestCase):
    """One graph, two languages.

    A block's text stops being a string and becomes a map of them (see
    `apps.common.i18n`). What is asserted here is the runtime half: which one
    of them reaches the customer, and that everything on the same message —
    buttons included — reaches them in that same language.
    """

    def make_price_flow(self, text, buttons=None) -> None:
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "m1", "type": "message", "text": text, **({"buttons": buttons} if buttons else {})},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            name="Narx",
        )

    def sent(self, result) -> dict:
        run = FlowRun.objects.get(pk=result["runId"])
        return run.steps.filter(actor="bot").order_by("-created_at").first().payload["payload"]

    def test_a_translated_message_is_sent_in_the_customers_language(self):
        self.make_price_flow({"uz": "690 000 so'm", "ru": "690 000 сум"})

        self.assertEqual(self.sent(dispatch(self.bot, russian_update("/narx")))["text"], "690 000 сум")
        self.assertEqual(self.sent(dispatch(self.bot, message_update("/narx")))["text"], "690 000 so'm")

    def test_a_plain_string_still_goes_out_exactly_as_it_always_did(self):
        # The whole compatibility promise: nothing saved before translations
        # existed answers any differently after them.
        self.make_price_flow("690 000 so'm")

        self.assertEqual(self.sent(dispatch(self.bot, russian_update("/narx")))["text"], "690 000 so'm")

    def test_placeholders_inside_a_translation_still_expand(self):
        # Resolving the language *after* substituting would substitute into a
        # dict, and every {{...}} in a translated message would reach the
        # customer as literal braces.
        self.make_price_flow({"uz": "Salom {{mijoz_ismi}}!", "ru": "Привет, {{mijoz_ismi}}!"})

        self.assertEqual(self.sent(dispatch(self.bot, russian_update("/narx")))["text"], "Привет, Dilnoza!")

    def test_the_buttons_follow_the_message_they_sit_under(self):
        self.make_price_flow(
            {"uz": "Tanlang:", "ru": "Выберите:"},
            buttons=[{"id": "b1", "label": {"uz": "Buyurtma", "ru": "Заказать"}, "kind": "callback"}],
        )

        payload = self.sent(dispatch(self.bot, russian_update("/narx")))
        self.assertEqual(payload["reply_markup"]["inline_keyboard"][0][0]["text"], "Заказать")

    def test_a_language_the_author_never_wrote_falls_back_to_the_bots_own(self):
        self.make_price_flow({"uz": "690 000 so'm"})

        self.assertEqual(self.sent(dispatch(self.bot, russian_update("/narx")))["text"], "690 000 so'm")

    def test_a_message_written_only_in_russian_is_sent_rather_than_nothing(self):
        # An author who wrote only the Russian half meant it to be sent; a bot
        # that answers with an empty string instead is simply broken.
        self.make_price_flow({"ru": "690 000 сум"})

        self.assertEqual(self.sent(dispatch(self.bot, message_update("/narx")))["text"], "690 000 сум")

    def test_picking_a_language_changes_the_rest_of_the_same_run(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "til"}},
                {"id": "l1", "type": "language", "text": {"uz": "Tilni tanlang:", "ru": "Выберите язык:"}},
                {"id": "m1", "type": "message", "text": {"uz": "Rahmat!", "ru": "Спасибо!"}},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "l1"},
                {"id": "e2", "from": "l1", "port": "out", "to": "m1"},
            ],
            name="Til",
        )
        started = dispatch(self.bot, message_update("/til"))

        dispatch(self.bot, callback_update("lang:ru"))

        run = FlowRun.objects.get(pk=started["runId"])
        self.assertEqual(run.steps.filter(actor="bot").order_by("-created_at").first().text, "Спасибо!")
        contact = Contact.objects.get(bot=self.bot, telegram_user_id=555)
        self.assertEqual(contact.language, "ru")

    def test_a_phone_switched_to_russian_is_noticed_on_the_next_message(self):
        self.make_price_flow({"uz": "690 000 so'm", "ru": "690 000 сум"})
        dispatch(self.bot, message_update("/narx"))

        result = dispatch(self.bot, russian_update("/narx", user_id=555))

        self.assertEqual(self.sent(result)["text"], "690 000 сум")

    def test_a_language_the_customer_picked_outranks_their_phone(self):
        self.make_price_flow({"uz": "690 000 so'm", "ru": "690 000 сум"})
        dispatch(self.bot, russian_update("/narx"))
        Contact.objects.get(bot=self.bot, telegram_user_id=556).set_language("uz")

        self.assertEqual(self.sent(dispatch(self.bot, russian_update("/narx")))["text"], "690 000 so'm")


class VenueLanguageTests(EngineTestCase):
    """A venue's name and address are copy, so they translate like any other."""

    def test_a_translated_venue_is_sent_in_the_contacts_language(self):
        self.bot.settings = {**self.bot.settings, "languages": {"main": "uz", "enabled": ["uz", "ru"]}}
        self.bot.save(update_fields=["settings"])
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "manzil"}},
                {
                    "id": "m1",
                    "type": "message",
                    "contentKind": "location",
                    "location": {
                        "latitude": 41.3,
                        "longitude": 69.2,
                        "title": {"uz": "Bosh ofis", "ru": "Главный офис"},
                        "address": {"uz": "Amir Temur 1", "ru": "Амира Темура 1"},
                    },
                },
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

        update = message_update("/manzil")
        update["message"]["from"]["language_code"] = "ru"
        run = FlowRun.objects.get(pk=dispatch(self.bot, update)["runId"])

        payload = run.steps.filter(actor="bot").get().payload["payload"]
        self.assertEqual(payload["title"], "Главный офис")
        self.assertEqual(payload["address"], "Амира Темура 1")

    def test_a_venue_written_before_translations_is_sent_unchanged(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "manzil2"}},
                {
                    "id": "m1",
                    "type": "message",
                    "contentKind": "location",
                    "location": {"latitude": 41.3, "longitude": 69.2, "title": "Bosh ofis", "address": "Amir Temur 1"},
                },
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            name="Eski manzil",
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/manzil2"))["runId"])

        payload = run.steps.filter(actor="bot").get().payload["payload"]
        self.assertEqual(payload["title"], "Bosh ofis")
