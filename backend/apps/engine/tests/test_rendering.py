"""What a customer actually receives, once the template has expanded.

Three faults lived here undetected because nothing measured the *result* of a
render — only its parts. Each test below is one of them, written as the message
the customer got rather than as the function that produced it.
"""

from django.test import TestCase

from apps.engine.sender import (
    FIELD_LIMITS,
    build_call,
    fit,
    neutralise_markup,
    render_markup,
    render_text,
)

from .base import *


class DefaultFilterTests(TestCase):
    """A hole in a sentence is worse than a placeholder — «Salom, !»"""

    def test_empty_value_falls_back(self):
        self.assertEqual(
            render_text('Salom, {{ism}}!', {"ism": ""}),
            "Salom, !",
        )
        self.assertEqual(
            render_text('Salom, {{ism | default: "mehmon"}}!', {"ism": ""}),
            "Salom, mehmon!",
        )

    def test_whitespace_counts_as_empty(self):
        """A tapped space is not an answer."""
        self.assertEqual(
            render_text('{{ism | default: "mehmon"}}', {"ism": "   "}),
            "mehmon",
        )

    def test_missing_name_falls_back_too(self):
        self.assertEqual(
            render_text('{{yoq | default: "mehmon"}}', {}),
            "mehmon",
        )

    def test_a_present_value_is_untouched(self):
        self.assertEqual(
            render_text('{{ism | default: "mehmon"}}', {"ism": "Aziza"}),
            "Aziza",
        )

    def test_unknown_name_without_a_filter_stays_visible(self):
        """Unchanged behaviour: a typo the author can see beats one they cannot."""
        self.assertEqual(render_text("Salom {{ism}}", {}), "Salom {{ism}}")

    def test_zero_is_a_value(self):
        """`0` and `False` are answers, not absences."""
        self.assertEqual(render_text('{{n | default: "yoq"}}', {"n": 0}), "0")

    def test_argument_may_contain_the_separator(self):
        self.assertEqual(
            render_text('{{x | default: "ha|yoq"}}', {}),
            "ha|yoq",
        )

    def test_an_unknown_filter_does_not_break_the_send(self):
        self.assertEqual(render_text("{{ism | yoqfiltr}}", {"ism": "Aziza"}), "Aziza")


class ValueNeutralisationTests(TestCase):
    """A customer's own name must not decide how the message is formatted."""

    def test_markers_in_a_value_are_neutralised(self):
        self.assertEqual(neutralise_markup("Ali*bek"), "Ali\\*bek")
        self.assertEqual(neutralise_markup("a_b_c"), "a\\_b\\_c")
        self.assertEqual(neutralise_markup("[x]"), "\\[x\\]")

    def test_a_backslash_doubles_first(self):
        self.assertEqual(neutralise_markup("a\\b"), "a\\\\b")

    def test_a_star_in_a_name_does_not_italicise_the_message(self):
        html = render_markup("Salom {{ism}}, xush kelibsiz", {"ism": "Ali*bek"})
        self.assertEqual(html, "Salom Ali*bek, xush kelibsiz")
        self.assertNotIn("<i>", html)
        self.assertNotIn("<b>", html)

    def test_an_unclosed_bracket_cannot_break_parsing(self):
        """This was `can't parse entities` — the message was never delivered."""
        html = render_markup("Buyurtma: {{izoh}}", {"izoh": "[yarim"})
        self.assertEqual(html, "Buyurtma: [yarim")

    def test_the_authors_own_markers_still_work(self):
        html = render_markup("*Muhim*: {{ism}}", {"ism": "Aziza"})
        self.assertEqual(html, "<b>Muhim</b>: Aziza")

    def test_html_in_a_value_is_still_escaped(self):
        html = render_markup("{{ism}}", {"ism": "<b>x</b>"})
        self.assertEqual(html, "&lt;b&gt;x&lt;/b&gt;")

    def test_plain_text_callers_get_no_backslashes(self):
        """A poll option and a trace line are read as typed."""
        self.assertEqual(render_text("{{ism}}", {"ism": "Ali*bek"}), "Ali*bek")

    def test_a_value_holding_a_placeholder_does_not_expand(self):
        """Substitution happens once — this is what keeps injection impossible."""
        self.assertEqual(
            render_text("{{a}}", {"a": "{{parol}}", "parol": "sir"}),
            "{{parol}}",
        )


class LengthTests(TestCase):
    def test_short_text_is_untouched(self):
        self.assertEqual(fit("qisqa", 4096), "qisqa")

    def test_a_long_body_is_cut_at_a_word(self):
        cut = fit("bir ikki uch to'rt besh", 12)
        self.assertTrue(cut.endswith("…"))
        self.assertLessEqual(len(cut), 12)
        self.assertNotIn("to'r", cut)

    def test_a_single_long_word_is_still_cut(self):
        cut = fit("a" * 100, 10)
        self.assertEqual(len(cut), 10)
        self.assertTrue(cut.endswith("…"))

    def test_the_expanded_message_is_what_gets_measured(self):
        """"Salom {{ism}}" is eleven characters until somebody long writes in."""
        node = {"type": "message", "text": "Salom {{ism}}"}
        _, payload = build_call(node, 1, {"ism": "x" * 9000})
        self.assertLessEqual(len(payload["text"]), FIELD_LIMITS["text"])

    def test_a_caption_gets_the_caption_limit(self):
        node = {
            "type": "message",
            "contentKind": "photo",
            "media": {"source": {"value": "file-id"}},
            "text": "{{izoh}}",
        }
        _, payload = build_call(node, 1, {"izoh": "x" * 3000})
        self.assertLessEqual(len(payload["caption"]), FIELD_LIMITS["caption"])

    def test_an_invoice_title_gets_its_own_much_tighter_limit(self):
        node = {
            "type": "message",
            "contentKind": "invoice",
            "invoice": {"title": "{{kurs}}", "description": "{{tavsif}}", "amount": "10"},
        }
        _, payload = build_call(
            node, 1, {"kurs": "K" * 200, "tavsif": "T" * 900}, provider_token="t"
        )
        self.assertLessEqual(len(payload["title"]), FIELD_LIMITS["invoice_title"])
        self.assertLessEqual(len(payload["description"]), FIELD_LIMITS["invoice_description"])

    def test_a_poll_option_is_cut_to_its_own_limit(self):
        node = {
            "type": "message",
            "contentKind": "poll",
            "poll": {"question": "{{savol}}", "options": [{"text": "{{javob}}", "id": "a"}]},
        }
        _, payload = build_call(node, 1, {"savol": "S" * 900, "javob": "J" * 400})
        self.assertLessEqual(len(payload["question"]), FIELD_LIMITS["poll_question"])
        self.assertLessEqual(len(payload["options"][0]), FIELD_LIMITS["poll_option"])


class DottedLookupTests(TestCase):
    """Two shapes live in one context, and both have to resolve."""

    def test_a_flat_key_containing_a_dot_still_wins(self):
        """Telegram's own fields are stored that way — `context["user.first_name"]`."""
        self.assertEqual(render_text("{{user.first_name}}", {"user.first_name": "Aziza"}), "Aziza")

    def test_a_structure_is_walked(self):
        """What a Kod block or the HTTP block answers with."""
        self.assertEqual(render_text("{{hisob.jami}}", {"hisob": {"jami": 36000}}), "36000")

    def test_the_flat_key_wins_over_the_walk(self):
        context = {"a.b": "tekis", "a": {"b": "ichma-ich"}}
        self.assertEqual(render_text("{{a.b}}", context), "tekis")

    def test_a_missing_branch_leaves_the_placeholder(self):
        self.assertEqual(render_text("{{hisob.yoq}}", {"hisob": {"jami": 1}}), "{{hisob.yoq}}")

    def test_walking_into_a_non_object_does_not_raise(self):
        self.assertEqual(render_text("{{a.b.c}}", {"a": {"b": 5}}), "{{a.b.c}}")

    def test_a_list_index_resolves(self):
        self.assertEqual(render_text("{{savat.0.nom}}", {"savat": [{"nom": "Kurs"}]}), "Kurs")

    def test_a_default_still_applies_to_a_missing_branch(self):
        self.assertEqual(
            render_text('{{hisob.yoq | default: "0"}}', {"hisob": {"jami": 1}}),
            "0",
        )
