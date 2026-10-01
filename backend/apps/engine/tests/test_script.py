"""What a script does when it works, and what it says when it does not.

The security half of this lives in `test_script_sandbox.py`. The two are apart
on purpose: one describes a feature and may change with it, the other is a
contract and may not.
"""

from unittest import skipUnless

from django.test import TestCase

from apps.engine.script import ScriptLimits, check_syntax, is_available, run_script
from apps.engine.script.sandbox import syntax_line

from .base import *

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")


@SCRIPTS
class ScriptValueTests(TestCase):
    def test_it_returns_a_number(self):
        result = run_script("return inputs.a + inputs.b", {"a": 2, "b": 3})
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.value, 5)

    def test_it_returns_an_object(self):
        result = run_script(
            "const jami = inputs.savat.reduce((s, x) => s + x.narx, 0);"
            "return { jami, chegirma: jami > 500000 ? 10 : 0 };",
            {"savat": [{"narx": 300000}, {"narx": 400000}]},
        )
        self.assertEqual(result.value, {"jami": 700000, "chegirma": 10})

    def test_a_script_that_returns_nothing_answers_null(self):
        """`undefined` has no JSON, and a block still has to be told something."""
        result = run_script("const x = 1;")
        self.assertTrue(result.ok)
        self.assertIsNone(result.value)

    def test_await_is_available_even_though_there_is_nothing_to_await(self):
        result = run_script("const x = await Promise.resolve(7); return x")
        self.assertEqual(result.value, 7)

    def test_the_context_reaches_the_script_as_readable_values(self):
        """A model instance in scope would be a database connection in scope."""
        result = run_script("return typeof inputs.sana", {"sana": object()})
        self.assertEqual(result.value, "string")


@SCRIPTS
class ScriptLogTests(TestCase):
    def test_console_log_comes_back_for_the_panel(self):
        result = run_script("console.log('salom', { a: 1 }); return 1")
        self.assertEqual(result.logs, ('salom {"a":1}',))

    def test_logs_are_capped(self):
        result = run_script("for (let i = 0; i < 500; i++) console.log(i); return 1", limits=ScriptLimits(log_lines=5))
        self.assertEqual(len(result.logs), 5)


@SCRIPTS
class ScriptFailureTests(TestCase):
    def test_a_syntax_error_is_the_authors_fault(self):
        """The name of this test was right and its assertion was not.

        It pinned `kind == "runtime"`, which is what the panel prints as «Kod
        ishlayotganda» — a missing bracket announced as a failure during an
        execution that never started, sending the author to look at what the
        script *did* instead of at what they typed. The test held that in place
        for as long as it existed, which is the thing a test is supposed to make
        impossible.
        """
        result = run_script("return (((")
        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "author")

    def test_a_thrown_error_is_not_the_authors_typing(self):
        """The other half of the same rule: this one really did run."""
        result = run_script("const n = 1;\nthrow new Error('narx topilmadi')")
        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "runtime")

    def test_a_thrown_error_keeps_its_message(self):
        result = run_script("throw new Error('narx topilmadi')")
        self.assertFalse(result.ok)
        self.assertIn("narx topilmadi", result.error)

    def test_a_value_json_cannot_carry_is_refused_in_the_authors_words(self):
        result = run_script("return { f: () => 1, c: 1n }")
        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "author")
        self.assertIn("oddiy qiymatlar", result.error)

    def test_an_endless_loop_is_killed(self):
        result = run_script("while (true) {}", limits=ScriptLimits(timeout_ms=700))
        self.assertEqual(result.kind, "timeout")

    def test_an_oversized_answer_is_refused(self):
        result = run_script("return 'x'.repeat(200000)")
        self.assertEqual(result.kind, "author")

    def test_a_memory_bomb_takes_only_its_own_process_down(self):
        result = run_script(
            "const a = []; while (true) { a.push(new Array(1e6).fill(7)); }",
            limits=ScriptLimits(timeout_ms=9000, memory_mb=48),
        )
        self.assertEqual(result.kind, "memory")
        # The point of the test is the line after it: the suite is still running.
        self.assertEqual(run_script("return 1").value, 1)

    def test_nothing_raises_whatever_the_script_does(self):
        """A block takes an exit; it never lets an exception into the runtime."""
        for source in ("while(true){}", "throw 1", "return (((", "process.exit(1)"):
            with self.subTest(source=source):
                result = run_script(source, limits=ScriptLimits(timeout_ms=700))
                self.assertIsNotNone(result.kind or result.ok)


@SCRIPTS
class ScriptLineTests(TestCase):
    """Where the fault was, counted in the source that was handed in.

    Not in the block the author has open — what is handed in is usually the
    bot's shared library with a block underneath it, and turning this number
    back into a place is `compose.locate`'s job (`test_compose.py`). What is
    asserted here is only that the number is honest about the string it was
    given, wrapper line and all.
    """

    def test_a_throw_names_the_line_it_was_thrown_on(self):
        result = run_script("const a = 1;\nconst b = 2;\nthrow new Error('shu yerda');")

        self.assertEqual(result.line, 3)

    def test_a_syntax_error_names_no_line(self):
        """The module never compiles, so no frame of the author's code exists
        — and a guessed line points at code that is fine."""
        result = run_script("const a = 1;\nreturn ((( ;")

        self.assertFalse(result.ok)
        self.assertIsNone(result.line)

    def test_something_thrown_that_is_not_an_error_names_no_line(self):
        result = run_script("throw 'narx yo\\'q';")

        self.assertFalse(result.ok)
        self.assertIsNone(result.line)

    def test_a_script_that_worked_carries_no_line(self):
        self.assertIsNone(run_script("return 1;").line)


class ScriptClockTests(TestCase):
    """`hozir` — the second argument, which was `null` on every run until now.

    `host.mjs` declared `(inputs, hozir)` from the day it was written and
    `sandbox.py` never sent the key behind it, so an author who reached for the
    obvious name got an empty value and no way to tell that from their own
    mistake. It is the server's clock, read once, and it is always a `Date`.
    """

    def test_it_is_a_real_date(self):
        result = run_script("return Object.prototype.toString.call(hozir);")
        self.assertEqual(result.value, "[object Date]")

    def test_it_carries_the_time_and_not_an_empty_value(self):
        result = run_script("return { yil: hozir.getFullYear(), yaqin: Math.abs(Date.now() - hozir.getTime()) < 60000 };")
        self.assertTrue(result.ok, result.error)
        self.assertGreater(result.value["yil"], 2020, "not the epoch, and not null")
        self.assertTrue(result.value["yaqin"], "the server's clock, not something invented")

    def test_it_does_not_move_while_the_script_runs(self):
        """Read once per run, so a script that asks twice cannot straddle a
        second and compute a difference nobody wrote."""
        result = run_script(
            "const first = hozir.getTime();"
            "await new Promise((done) => setTimeout(done, 40));"
            "return first === hozir.getTime();"
        )
        self.assertIs(result.value, True)


@SCRIPTS
class SyntaxLineTests(TestCase):
    """A file that will not compile has to say *where*.

    This is the one fault that arrives with no line of its own. `host.mjs`
    reads the line out of the stack V8 wrote for a throw, and a module that
    never compiled has no such stack: the `SyntaxError` a dynamic `import()`
    rejects with carries Node's internal frames and nothing of the source. So
    the refusal used to be «Unexpected token '='» about a two-hundred-line
    library — a true sentence and an unusable one.
    """

    def test_it_names_the_line_the_author_can_see(self):
        found = syntax_line("const a = 1;\nconst b = 2;\nconst = obj.model\n")

        self.assertEqual(found, 3)

    def test_a_file_that_compiles_has_no_line(self):
        self.assertIsNone(syntax_line("function ok() {\n  return 1;\n}"))

    def test_a_top_level_return_is_not_a_syntax_error(self):
        """The author's text is the body of an async function — that is the
        contract `host.mjs` folds it into and the reason `return` is how a
        script answers. A locator that compiled it bare would report a fault in
        every working script in the product."""
        self.assertIsNone(syntax_line("const a = 1;\nreturn a;"))

    def test_the_refusal_carries_it(self):
        """`check_syntax` is what the two save endpoints call, and its sentence
        is what the panel underlines from."""
        problem = check_syntax("const a = 1;\nconst b = 2;\nconst = obj.model\n")

        self.assertIn("3-qator", problem)

    def test_a_file_that_compiles_is_still_stored(self):
        self.assertIsNone(check_syntax("function chegirma(n) { return n * 0.9; }"))

