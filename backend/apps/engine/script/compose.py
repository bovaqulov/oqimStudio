"""Putting one Kod block's script together, and finding the way back out.

An author who writes four lines of arithmetic in a block wants the same four
lines in the next one, and the sandbox has nowhere to put them: a resolve hook
in `host.mjs` refuses every `node:` specifier, which is the third of the six
boundaries in `sandbox`. Opening a module system to let a shared file in would
be opening the loader, so sharing happens *before* the code gets there — the
bot carries one library of its own and it is prepended to every block. That
buys a helper function without buying a loader.

What it costs is line numbers, and that is the whole reason this is a module
and not a `+` at the call site. The sandbox runs one body and reports a fault
against a line of *that* body, while the author is looking at two separate
editors: a message pointing at line 14 of a nine-line block sends them hunting
through code that is fine, which is worse than saying nothing. So `compose`
hands back how many lines the library took, and `locate` turns the sandbox's
number back into the editor the author has open and the line they can see in
it.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The three places a script's code can come from.
LIBRARY = "library"
BLOCK = "block"
#: The flow's own file — the hooks in `engine.hooks`. Composed the same way a
#: block is, under the same library, and separated only so that a fault in it
#: is reported against the editor the author actually has open.
FLOW = "flow"

#: What each one is called in the sentence the author reads on the step.
ORIGIN_LABELS = {LIBRARY: "kutubxona", BLOCK: "blok", FLOW: "oqim skripti"}

#: Where a script's answer is kept when the block names nowhere.
#:
#: Here rather than in the runtime because two callers have to agree on it: the
#: runtime writes the value under this name, and the Kod panel lists what every
#: block in the bot writes. A panel showing an empty cell for a block that does
#: write something is how an author goes looking for a variable already there.
DEFAULT_VARIABLE = "hisob"


@dataclass(frozen=True)
class ScriptOrigin:
    """One place in the author's code: which editor, and the line in it."""

    #: `LIBRARY` or `BLOCK`.
    where: str
    #: 1-based, counted in that source and not in the composed body.
    line: int

    @property
    def label(self) -> str:
        """The word for `where` in a message an author reads."""
        return ORIGIN_LABELS.get(self.where, self.where)


@dataclass(frozen=True)
class ComposedScript:
    """What the sandbox is handed, plus what it takes to read its answer."""

    #: The library and the block as one body — the string `run_script` runs.
    source: str
    #: How many lines of `source` belong to the library. Zero means the body is
    #: the block byte for byte, which is the case `locate` must not disturb.
    library_lines: int
    #: Which editor the *lower* half is, for the sentence `locate` builds. Only
    #: the caller knows: the same function composes a Kod block and a flow
    #: script, and "blokda 4-qator" about a file that is not a block sends the
    #: author looking through the wrong editor.
    where: str = BLOCK

    @property
    def has_library(self) -> bool:
        return self.library_lines > 0

    @property
    def total_lines(self) -> int:
        """How many lines the sandbox was actually handed.

        The ceiling `locate` refuses to translate past. A reported line comes
        off `error.stack`, which the author's own module shares a realm with
        and may rewrite — so it is a number a tenant can choose, and a chosen
        one is not bounded by anything the sandbox knows.
        """
        return self.source.count("\n") + 1 if self.source else 0


def compose(library: str, source: str, where: str = BLOCK) -> ComposedScript:
    """The bot's shared library above one block's script, as a single body."""
    body = _normalise(source)
    # Trailing blank lines go first, so that "the block starts at
    # `library_lines + 1`" holds however the author left the end of the file.
    shared = _normalise(library).rstrip("\n")

    if not shared.strip():
        # No library is the ordinary case and it has to cost nothing: the
        # composed body is the block unchanged, so every number the sandbox
        # reports already means what the block's own editor says it means.
        return ComposedScript(source=body, library_lines=0, where=where)

    # Exactly one newline joins them, and it is not optional: a library whose
    # last line is `// ...` would otherwise comment out the block's first line,
    # and the author would be reading a working library and a block that
    # silently lost a statement.
    return ComposedScript(source=f"{shared}\n{body}", library_lines=shared.count("\n") + 1, where=where)


def locate(composed: ComposedScript, line: int | None) -> ScriptOrigin | None:
    """Which of the two sources line `line` of the composed body came from.

    None when there is nothing to translate. A syntax error is caught while the
    module is compiled, before any frame of the author's code exists, so no
    line comes back at all — and a guessed one would send somebody to a line
    that is fine.
    """
    # `bool` is an `int` in Python, and `True` would translate to line 1 of the
    # library — a confident answer built out of a value that never meant one.
    if not isinstance(line, int) or isinstance(line, bool) or line < 1:
        return None
    # Past the end of what was actually run, so it came from a stack that was
    # rewritten rather than thrown. Not a way out of the sandbox — the six
    # boundaries are elsewhere and none of them is a line number — but a way to
    # make the panel print `blokda 99998-qator` about a nine-line block, which
    # is a confident answer to a question nobody can act on. Silence is the
    # answer this module already gives a syntax error, for the same reason.
    if line > composed.total_lines:
        return None
    if line <= composed.library_lines:
        return ScriptOrigin(LIBRARY, line)
    return ScriptOrigin(composed.where, line - composed.library_lines)


def _normalise(text: str) -> str:
    """Line endings reduced to `\\n`, so counting them is counting lines.

    A library pasted out of a Windows editor arrives with `\\r\\n`; left alone
    the count is still right, but the `\\r` travels into the composed body and
    ends up inside the author's own strings.
    """
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n")
