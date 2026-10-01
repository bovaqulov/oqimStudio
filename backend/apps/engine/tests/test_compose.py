"""The library above the block, and the way back from a line number.

Two halves. The first is arithmetic and runs anywhere: given a library of *n*
lines, which source does line *k* of the composed body belong to. The second
drives the real sandbox, because the arithmetic is only worth anything if the
number it is fed is the number Node actually reports — the two have to agree
about the wrapper line `host.mjs` folds the body into, and nothing but running
it can check that.
"""

from unittest import skipUnless

from django.test import SimpleTestCase

from apps.engine.script import BLOCK, FLOW, compose, is_available, locate, run_script

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

LIBRARY = "function chegirma(narx) {\n  return narx > 100 ? 10 : 0;\n}"


class ComposeTests(SimpleTestCase):
    def test_without_a_library_the_body_is_the_block_unchanged(self):
        """The ordinary case has to cost nothing — not one shifted line."""
        composed = compose("", "return 1;")

        self.assertEqual(composed.source, "return 1;")
        self.assertEqual(composed.library_lines, 0)
        self.assertFalse(composed.has_library)

    def test_a_library_of_only_whitespace_is_no_library(self):
        composed = compose("   \n\n  ", "return 1;")

        self.assertEqual(composed.source, "return 1;")
        self.assertEqual(composed.library_lines, 0)

    def test_the_library_comes_first_and_is_counted(self):
        composed = compose(LIBRARY, "return chegirma(inputs.narx);")

        self.assertTrue(composed.source.startswith("function chegirma"))
        self.assertTrue(composed.source.endswith("return chegirma(inputs.narx);"))
        self.assertEqual(composed.library_lines, 3)

    def test_trailing_blank_lines_in_the_library_do_not_move_the_block(self):
        """Otherwise every line of every block shifts by however many times
        somebody pressed Enter at the bottom of the shared file."""
        tidy = compose(LIBRARY, "return 1;")
        padded = compose(LIBRARY + "\n\n\n", "return 1;")

        self.assertEqual(padded.library_lines, tidy.library_lines)
        self.assertEqual(padded.source, tidy.source)

    def test_windows_line_endings_do_not_reach_the_composed_body(self):
        composed = compose("const a = 1;\r\nconst b = 2;", "return a + b;\r\n")

        self.assertNotIn("\r", composed.source)
        self.assertEqual(composed.library_lines, 2)


class LocateTests(SimpleTestCase):
    """A number counted over both sources, turned back into a place."""

    def test_without_a_library_every_line_is_the_blocks_own(self):
        origin = locate(compose("", "a\nb\nc"), 3)

        self.assertEqual((origin.where, origin.line), ("block", 3))

    def test_a_line_inside_the_library_keeps_its_number(self):
        origin = locate(compose(LIBRARY, "return 1;"), 2)

        self.assertEqual((origin.where, origin.line), ("library", 2))
        self.assertEqual(origin.label, "kutubxona")

    def test_the_blocks_first_line_is_the_one_after_the_library(self):
        composed = compose(LIBRARY, "return chegirma(1);")

        origin = locate(composed, composed.library_lines + 1)

        self.assertEqual((origin.where, origin.line), ("block", 1))
        self.assertEqual(origin.label, "blok")

    def test_the_last_line_of_the_library_is_still_the_library(self):
        composed = compose(LIBRARY, "return 1;")

        self.assertEqual(locate(composed, composed.library_lines).where, "library")

    def test_nothing_is_invented_when_there_is_no_line(self):
        """A syntax error names no line, and a guess sends the author to one
        that is fine."""
        composed = compose(LIBRARY, "return 1;")

        for reported in (None, 0, -4, "2", True, 1.0):
            with self.subTest(reported=reported):
                self.assertIsNone(locate(composed, reported))


@SCRIPTS
class ComposedScriptTests(SimpleTestCase):
    """What the sandbox does with a composed body, and what it reports back."""

    def test_the_block_can_call_what_the_library_defines(self):
        composed = compose(LIBRARY, "return chegirma(inputs.narx);")

        result = run_script(composed.source, {"narx": 500})

        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.value, 10)

    def test_a_library_ending_in_a_comment_does_not_swallow_the_block(self):
        """The joining newline is the whole reason this passes: without it the
        block's first line would be inside the library's last comment."""
        composed = compose("const soliq = 12; // foizda", "return soliq;")

        result = run_script(composed.source, {})

        self.assertEqual(result.value, 12)

    def test_a_fault_in_the_library_is_reported_at_its_own_line(self):
        library = "function narx() {\n  throw new Error('narx yo\\'q');\n}"
        composed = compose(library, "return narx();")

        result = run_script(composed.source, {})
        origin = locate(composed, result.line)

        self.assertFalse(result.ok)
        self.assertEqual((origin.where, origin.line), ("library", 2))

    def test_a_fault_in_the_block_is_reported_at_the_line_the_author_sees(self):
        composed = compose(LIBRARY, "const a = 1;\nundefinedFn();\nreturn a;")

        result = run_script(composed.source, {})
        origin = locate(composed, result.line)

        self.assertEqual((origin.where, origin.line), ("block", 2))

    def test_the_line_is_the_same_with_and_without_a_library(self):
        """The point of the whole module: the author's number does not depend
        on how long the shared file happens to be today."""
        block = "const a = 1;\nthrow new Error('shu yerda');"

        bare = compose("", block)
        shared = compose(LIBRARY + "\n" + LIBRARY, block)

        self.assertEqual(
            locate(bare, run_script(bare.source, {}).line),
            locate(shared, run_script(shared.source, {}).line),
        )


class ForgedLineTests(SimpleTestCase):
    """A reported line is tenant-influenced data, so it has a ceiling.

    `host.mjs` reads it off `error.stack`, and the author's module shares that
    realm — `Error.prepareStackTrace` is writable, and rewriting it does change
    the number that comes back. Nothing about the six boundaries depends on
    this; what it buys is a panel that says `blokda 99998-qator` about a
    nine-line block, which is worse than saying nothing.
    """

    def test_a_line_past_the_end_is_not_translated(self):
        composed = compose("", "return 1;\nreturn 2;")

        self.assertIsNone(locate(composed, 99_998))

    def test_the_last_real_line_still_is(self):
        composed = compose("", "return 1;\nreturn 2;")

        origin = locate(composed, 2)

        self.assertIsNotNone(origin)
        self.assertEqual((origin.where, origin.line), (BLOCK, 2))

    def test_the_ceiling_counts_the_library_too(self):
        composed = compose("const a = 1;\nconst b = 2;", "return a + b;")

        self.assertEqual(composed.total_lines, 3)
        self.assertIsNotNone(locate(composed, 3))
        self.assertIsNone(locate(composed, 4))


class LowerHalfTests(SimpleTestCase):
    """Which editor the half under the library is.

    The same function composes a Kod block and a flow's own script, and only
    the caller knows which. Reporting «blokda 4-qator» about a file that is not
    a block sends the author through the wrong editor looking for a line that
    is fine there — the exact failure `locate` exists to prevent, pointed one
    level up.
    """

    def test_a_block_is_still_the_default(self):
        origin = locate(compose(LIBRARY, "return 1;"), 4)

        self.assertEqual((origin.where, origin.label), (BLOCK, "blok"))

    def test_a_flow_script_says_so(self):
        origin = locate(compose(LIBRARY, "return 1;", FLOW), 4)

        self.assertEqual((origin.where, origin.line), (FLOW, 1))
        self.assertEqual(origin.label, "oqim skripti")

    def test_the_library_half_is_unaffected_by_it(self):
        origin = locate(compose(LIBRARY, "return 1;", FLOW), 2)

        self.assertEqual(origin.where, "library")
