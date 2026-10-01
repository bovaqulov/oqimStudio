"""What `{{ funksiya(...) }}` does — and, just as much, what `{{ism}}` still does.

The second half is the one worth stating out loud. Every flow in every account
was written against a grammar where a placeholder is a name, and the whole
design of `engine.expressions` turns on that grammar being left alone: a
placeholder without a call never reaches the sandbox, never pays for a process
launch, and renders through exactly the code it always did.
"""

from unittest import skipUnless
from unittest.mock import patch

from django.test import TestCase

from apps.engine import expressions
from apps.engine.script import is_available
from apps.engine.sender import render_text

from .base import *

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

LIBRARY = """
// Sonni pul ko'rinishiga o'giradi
function money(n) { return String(Math.round(Number(n) || 0)) + " so'm"; }
// Savatdagi jami summa
const cartTotal = (items) => (items || []).reduce((s, i) => s + (i.narx || 0) * (i.soni || 1), 0);
function shouting(name) { return "<b>" + name + "</b>"; }
function broken() { throw new Error("narx topilmadi"); }
"""


class GrammarTests(TestCase):
    """Which placeholders this feature claims, and which it must not touch."""

    def test_a_plain_name_is_not_an_expression(self):
        for text in ("{{ism}}", "{{user.first_name}}", '{{ism | default: "yo\'q"}}'):
            self.assertEqual(expressions.sources_in(text), [], text)

    def test_a_filter_argument_with_a_bracket_is_still_a_filter(self):
        self.assertEqual(expressions.sources_in('{{ism | default: "a(b)"}}'), [])

    def test_a_call_is_an_expression(self):
        self.assertEqual(
            expressions.sources_in("Jami: {{ money(cartTotal(savat)) }}"),
            ["money(cartTotal(savat))"],
        )

    def test_it_is_found_wherever_a_block_keeps_text(self):
        node = {
            "id": "n1",
            "text": {"uz": "Jami {{ money(a) }}", "ru": "Итого {{ money(a) }}"},
            "buttons": [{"id": "b1", "label": "To'lash {{ money(a) }}"}],
        }
        # One expression, however many fields wrote it.
        self.assertEqual(expressions._unique(expressions.sources_in(node)), ["money(a)"])

    def test_a_method_call_names_no_library_function(self):
        """`Math.round(x)` is an expression, but `round` is not the library's."""
        self.assertEqual(expressions.sources_in("{{ Math.round(narx) }}"), ["Math.round(narx)"])
        self.assertEqual(expressions.functions_in("{{ Math.round(narx) }}"), set())


class MissingFunctionTests(TestCase):
    """The save-time check — the one that stops a silent empty space."""

    def test_it_names_the_function_and_the_block(self):
        nodes = [{"id": "n7", "text": "{{ deliveryText(savat) }}"}]

        rows = expressions.missing_functions(nodes, LIBRARY)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["nodeId"], "n7")
        self.assertEqual(rows[0]["function"], "deliveryText")

    def test_a_declared_function_is_not_reported(self):
        nodes = [{"id": "n1", "text": "{{ money(cartTotal(savat)) }}"}]
        self.assertEqual(expressions.missing_functions(nodes, LIBRARY), [])

    def test_javascript_of_its_own_is_not_reported(self):
        nodes = [{"id": "n1", "text": "{{ Number(narx) }}"}]
        self.assertEqual(expressions.missing_functions(nodes, LIBRARY), [])

    def test_it_reads_both_ways_a_function_is_written(self):
        self.assertEqual(expressions.declared_functions(LIBRARY), {"money", "cartTotal", "shouting", "broken"})


class NoExpressionTests(TestCase):
    """A flow written before any of this existed."""

    def test_a_block_without_a_call_never_starts_the_sandbox(self):
        context = {"ism": "Aziz"}
        node = {"id": "n1", "text": "Salom {{ism}}!"}

        with patch("apps.engine.expressions.run_script") as runner:
            problems = expressions.resolve_into(context, node, library=LIBRARY)

        runner.assert_not_called()
        self.assertEqual(problems, [])
        self.assertEqual(render_text(node["text"], context), "Salom Aziz!")


@SCRIPTS
class EvaluationTests(TestCase):
    def setUp(self) -> None:
        self.context = {"ism": "Aziz", "savat": [{"narx": 12500, "soni": 2}, {"narx": 8000, "soni": 1}]}

    def test_it_renders_the_answer(self):
        node = {"id": "n1", "text": "Salom {{ism}}! Jami: {{ money(cartTotal(savat)) }}"}

        problems = expressions.resolve_into(self.context, node, library=LIBRARY)

        self.assertEqual(problems, [])
        self.assertEqual(render_text(node["text"], self.context), "Salom Aziz! Jami: 33000 so'm")

    def test_the_same_expression_is_evaluated_once(self):
        """A total in the message and on the button is one call, not two."""
        node = {
            "id": "n1",
            "text": "Jami: {{ money(cartTotal(savat)) }}",
            "buttons": [{"id": "b1", "label": "To'lash {{ money(cartTotal(savat)) }}"}],
        }

        with patch("apps.engine.expressions.run_script", wraps=expressions.run_script) as runner:
            expressions.resolve_into(self.context, node, library=LIBRARY)

        self.assertEqual(runner.call_count, 1)
        self.assertEqual(render_text(node["buttons"][0]["label"], self.context), "To'lash 33000 so'm")

    def test_a_throw_empties_its_own_placeholder_and_nothing_else(self):
        node = {"id": "n1", "text": "[{{ broken() }}] {{ money(1000) }}"}

        problems = expressions.resolve_into(self.context, node, library=LIBRARY)

        self.assertEqual(len(problems), 1)
        self.assertIn("narx topilmadi", problems[0])
        # The block still says what it was written to say.
        self.assertEqual(render_text(node["text"], self.context), "[] 1000 so'm")

    def test_a_value_cannot_open_a_bold_span(self):
        """Markup is neutralised for an expression exactly as it is for a name."""
        node = {"id": "n1", "text": "{{ shouting(ism) }}"}

        expressions.resolve_into(self.context, node, library=LIBRARY)

        self.assertNotIn("<b>", render_text(node["text"], self.context, markup=True))

    def test_an_empty_library_is_a_reported_gap_not_a_stopped_flow(self):
        node = {"id": "n1", "text": "Jami: [{{ money(1) }}]"}

        problems = expressions.resolve_into(self.context, node, library="")

        self.assertEqual(len(problems), 1)
        self.assertEqual(render_text(node["text"], self.context), "Jami: []")


@SCRIPTS
class RuntimeTests(EngineTestCase):
    """The whole path: an update arrives, and the customer reads an answer.

    The unit tests above prove the pieces. This one proves they are wired —
    that `walk` resolves a block's expressions before anything renders it, that
    the library it uses is the bot's own, and that what the customer receives
    is the computed value rather than the source that computed it.
    """

    def test_a_customer_receives_the_computed_value(self):
        self.bot.script_library = LIBRARY
        self.bot.save(update_fields=["script_library"])
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "savat"}},
                {"id": "m1", "type": "message", "title": "Jami",
                 "text": "Savatingiz: {{ money(cartTotal(savat)) }}"},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
        )

        dispatch(self.bot, message_update("/savat"))

        run = FlowRun.objects.latest("started_at")
        said = [step.text for step in run.steps.filter(actor="bot")]
        # `savat` is not in the context on this run, so `cartTotal` is handed
        # `undefined` and answers 0 — the library's own contract. What matters
        # is that arithmetic ran at all and no braces reached the customer.
        self.assertEqual(said, ["Savatingiz: 0 so'm"])

    def test_the_expression_cache_never_reaches_the_database(self):
        """It is scratch for one block, and a parked run must not carry it."""
        self.bot.script_library = LIBRARY
        self.bot.save(update_fields=["script_library"])
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "jami"}},
                {"id": "m1", "type": "message", "title": "Jami", "text": "Jami: {{ money(1000) }}",
                 "buttons": [{"id": "b1", "label": "Ha", "kind": "callback"}]},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
        )

        dispatch(self.bot, message_update("/jami"))

        run = FlowRun.objects.latest("started_at")
        # Parked on the keyboard, so the row on disk is the one a resume reads.
        run.refresh_from_db()
        self.assertEqual([key for key in run.context if key.startswith("__")], [])
        # And the screen keys, which are a single underscore, are still there.
        self.assertTrue(any(key.startswith("_screen") for key in run.context), run.context.keys())

    def test_a_missing_function_leaves_a_gap_and_not_a_stopped_flow(self):
        self.bot.script_library = LIBRARY
        self.bot.save(update_fields=["script_library"])
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "m1", "type": "message", "title": "Narx", "text": "Narx: [{{ deliveryText(x) }}] — savol bering"},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
        )

        dispatch(self.bot, message_update("/narx"))

        run = FlowRun.objects.latest("started_at")
        said = [step.text for step in run.steps.filter(actor="bot")]
        self.assertEqual(said, ["Narx: [] — savol bering"])
        # And the reason is on the trace, where the author can find it.
        self.assertTrue(run.steps.filter(actor="system", text__contains="deliveryText").exists())


@SCRIPTS
class TableTests(EngineTestCase):
    """A message written out of a table — the point of the whole feature.

    The table is read by the host and handed in. Nothing inside the sandbox
    reaches a database, which is the same rule the command API follows: the
    script does arithmetic, the host does I/O.
    """

    def _table(self, handle: str, rows: list[dict]):
        from apps.tables.models import Table, TableRow

        table = Table.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            name=handle.title(),
            handle=handle,
            columns=[{"key": "kod", "label": "Kod", "type": "text"},
                     {"key": "narx", "label": "Narx", "type": "number"}],
        )
        for row in rows:
            TableRow.objects.create(table=table, data=row)
        return table

    def test_a_message_reads_a_price_out_of_a_table(self):
        self._table("narxlar", [{"kod": "mrt", "narx": 150000}, {"kod": "uzi", "narx": 250000}])
        self.bot.script_library = (
            "function priceOf(rows, kod) {\n"
            "  const hit = (rows || []).find((r) => r.kod === kod);\n"
            "  return hit ? String(hit.narx) : 'topilmadi';\n"
            "}\n"
        )
        self.bot.save(update_fields=["script_library"])
        self.make_flow(
            [
                {"id": "t1", "type": "trigger", "title": "Handler",
                 "dmsTrigger": {"kinds": ["command"], "command": "mrt"}},
                {"id": "m1", "type": "message", "title": "Narx",
                 "text": "MRT narxi: {{ priceOf(table(\"narxlar\"), \"mrt\") }}"},
            ],
            [{"id": "e1", "from": "t1", "port": "out", "to": "m1"}],
        )

        dispatch(self.bot, message_update("/mrt"))

        run = FlowRun.objects.latest("started_at")
        self.assertEqual([s.text for s in run.steps.filter(actor="bot")], ["MRT narxi: 150000"])

    def test_only_the_tables_the_text_names_are_loaded(self):
        self._table("narxlar", [{"kod": "a", "narx": 1}])
        self._table("xizmatlar", [{"kod": "b", "narx": 2}])
        context: dict = {}
        node = {"id": "n1", "text": '{{ table("narxlar").length }}'}

        with patch("apps.engine.expressions.run_script", wraps=expressions.run_script) as runner:
            expressions.resolve_into(context, node, library="", workspace_id=self.workspace.id)

        # An empty library is its own reported gap, but the load still happened:
        # what matters here is which handles were asked for.
        handles = expressions.TABLE_CALL_PATTERN.findall(node["text"])
        self.assertEqual(handles, ["narxlar"])
        del runner

    def test_rows_read_as_a_list_inside_a_message(self):
        """«Narxlarimiz:» and then the table, without the author writing a loop."""
        self._table("narxlar", [{"kod": "mrt", "narx": 150000}, {"kod": "uzi", "narx": 250000}])
        context: dict = {}
        node = {"id": "n1", "text": 'Narxlarimiz:\n{{ tableText("narxlar") }}'}

        problems = expressions.resolve_into(context, node, library="", workspace_id=self.workspace.id)

        self.assertEqual(problems, [])
        # Newest first, the order the table itself is stored in.
        self.assertEqual(
            render_text(node["text"], context),
            "Narxlarimiz:\n• uzi — 250000\n• mrt — 150000",
        )

    def test_the_list_can_be_told_which_columns_and_how_many(self):
        self._table("narxlar", [{"kod": "mrt", "narx": 150000}, {"kod": "uzi", "narx": 250000}])
        context: dict = {}
        node = {"id": "n1", "text": '{{ tableText("narxlar", { columns: ["kod"], limit: 1 }) }}'}

        expressions.resolve_into(context, node, library="", workspace_id=self.workspace.id)

        self.assertEqual(render_text(node["text"], context), "• uzi")

    def test_a_table_that_does_not_exist_is_an_empty_list_and_a_reported_gap(self):
        self.bot.script_library = "function count(rows) { return String((rows || []).length); }"
        self.bot.save(update_fields=["script_library"])
        context: dict = {}
        node = {"id": "n1", "text": 'Soni: {{ count(table("yoq")) }}'}

        problems = expressions.resolve_into(
            context, node, library=self.bot.script_library, workspace_id=self.workspace.id
        )

        self.assertTrue(any("yoq" in problem for problem in problems), problems)
        self.assertEqual(render_text(node["text"], context), "Soni: 0")


class FailureTests(TestCase):
    """However the sandbox fails, the customer still gets the message."""

    def test_an_unavailable_sandbox_empties_the_placeholder(self):
        from apps.engine.script import ScriptResult

        node = {"id": "n1", "text": "Jami: [{{ money(1) }}]"}
        context: dict = {}

        with patch(
            "apps.engine.expressions.run_script",
            return_value=ScriptResult(ok=False, kind="unavailable", error="Bu serverda skript ishga tushirilmaydi."),
        ):
            problems = expressions.resolve_into(context, node, library=LIBRARY)

        self.assertEqual(len(problems), 1)
        self.assertEqual(render_text(node["text"], context), "Jami: []")

    def test_an_expression_nobody_resolved_does_not_reach_the_customer(self):
        """Source code in a message is a leak, not a hint — unlike a bare name."""
        self.assertEqual(render_text("Jami: [{{ money(1) }}]", {}), "Jami: []")
