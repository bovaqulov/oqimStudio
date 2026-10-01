"""The editor stores MarkdownV2; the customer has to receive formatting."""

from django.test import TestCase

from apps.engine.markdown import to_html

from .base import *


class MarkdownToHtmlTests(TestCase):
    def test_plain_prose_survives_unchanged(self):
        # The reason HTML was chosen over MarkdownV2: this sentence ends in a
        # full stop, which MarkdownV2 would have refused to parse.
        self.assertEqual(to_html("Matnni shu yerga yozing."), "Matnni shu yerga yozing.")

    def test_the_markers_the_toolbar_writes(self):
        self.assertEqual(to_html("*qalin*"), "<b>qalin</b>")
        self.assertEqual(to_html("_kursiv_"), "<i>kursiv</i>")
        self.assertEqual(to_html("__tagi__"), "<u>tagi</u>")
        self.assertEqual(to_html("~chizilgan~"), "<s>chizilgan</s>")
        self.assertEqual(to_html("||sir||"), "<tg-spoiler>sir</tg-spoiler>")
        self.assertEqual(to_html("`kod`"), "<code>kod</code>")

    def test_underline_wins_over_italic(self):
        """`__` is tried first, or it would open an italic and close it at once."""
        self.assertEqual(to_html("__ikki__"), "<u>ikki</u>")

    def test_a_link_carries_its_label(self):
        self.assertEqual(to_html("[sayt](https://a.uz)"), '<a href="https://a.uz">sayt</a>')

    def test_nesting(self):
        self.assertEqual(to_html("*qalin _va kursiv_*"), "<b>qalin <i>va kursiv</i></b>")

    def test_code_takes_no_nested_markers(self):
        self.assertEqual(to_html("`*yulduz*`"), "<code>*yulduz*</code>")

    def test_an_unclosed_marker_is_the_character_the_author_typed(self):
        self.assertEqual(to_html("2 * 3 = 6"), "2 * 3 = 6")
        self.assertEqual(to_html("narx_dan"), "narx_dan")

    def test_an_empty_span_is_not_formatting(self):
        """Telegram rejects an empty entity, and `**` is two asterisks."""
        self.assertEqual(to_html("**"), "**")

    def test_html_characters_are_escaped(self):
        self.assertEqual(to_html("narx < 100 & > 50"), "narx &lt; 100 &amp; &gt; 50")

    def test_a_backslash_writes_a_literal_marker(self):
        self.assertEqual(to_html(r"\*yulduz\*"), "*yulduz*")

    def test_a_quote_becomes_a_blockquote(self):
        self.assertEqual(to_html("> birinchi\n> ikkinchi"), "<blockquote>birinchi\nikkinchi</blockquote>")

    def test_a_greater_than_mid_line_stays_text(self):
        self.assertEqual(to_html("a > b"), "a &gt; b")


class MarkdownReachesTelegramTests(EngineTestCase):
    def test_a_bold_message_is_sent_with_parse_mode(self):
        self.make_flow(
            [
                {"id": "n1", "type": "start"},
                {"id": "n2", "type": "message", "text": "*To'lov qabul qilindi*"},
            ],
            [{"id": "e1", "from": "n1", "port": "out", "to": "n2"}],
            name="Rahmat",
            is_main=True,
        )
        started = dispatch(self.bot, message_update("/start"))
        run = FlowRun.objects.get(pk=started["runId"])
        sent = run.steps.filter(actor="bot").order_by("-created_at").first().payload["payload"]

        # The apostrophe is not one of the three characters HTML reserves, so
        # it travels as itself — escaping it would show up as `&#39;`.
        self.assertEqual(sent["text"], "<b>To'lov qabul qilindi</b>")
        self.assertEqual(sent["parse_mode"], "HTML")
