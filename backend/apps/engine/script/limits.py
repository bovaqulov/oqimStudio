"""What a script may spend, and what it can answer.

Split from the runner because these two are the *contract* — a block, a test
panel and an API all speak in them, and none of those needs to know that a
subprocess is involved.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Why a script did not answer. A small closed vocabulary, because a block
#: branches on it and a panel colours by it — neither can read a sentence.
#:
#:   ``author``       the script is wrong: a syntax error, an import, a value
#:                    that will not serialise. Belongs on the canvas.
#:   ``timeout``      it did not finish in time.
#:   ``memory``       it asked for more than it may have.
#:   ``runtime``      it threw while running.
#:   ``busy``         too many scripts are running at once and this one was not
#:                    started (`concurrency`).
#:   ``unavailable``  this machine cannot run scripts; the flow carries on as
#:                    though the block were not there.
FAILURE_KINDS = ("author", "timeout", "memory", "runtime", "busy", "unavailable")

#: Its own name because two modules branch on it: `sandbox` reports it and the
#: runtime says something different about it on the step.
#:
#: Not folded into ``unavailable``, though the two are neighbours, because the
#: author's next move differs and that is the only thing `kind` is for.
#: ``unavailable`` is permanent and theirs to do nothing about — no Node on
#: this deployment — while ``busy`` is this second and gone the next, and the
#: right answer to it is to press the button again.
BUSY = "busy"


@dataclass(frozen=True)
class ScriptLimits:
    """The budget one script gets.

    The defaults are sized for what this is *for*: a calculation between two
    messages, while somebody waits in a chat. Telegram gives a webhook a few
    seconds in total and a script is one step inside that, so two seconds is
    already generous — a script that needs longer is a script that should have
    been an HTTP call to something that owns the work.
    """

    #: Wall clock. Past this the process is killed, not asked to stop.
    timeout_ms: int = 2000
    #: V8 old-space ceiling, in megabytes.
    memory_mb: int = 64
    #: How much JSON the answer may be.
    output_bytes: int = 64 * 1024
    #: `console.log` lines kept for the author's panel.
    log_lines: int = 50


@dataclass(frozen=True)
class ScriptResult:
    """What happened, in a shape a block can branch on."""

    ok: bool
    value: Any = None
    logs: tuple[str, ...] = ()
    error: str = ""
    kind: str = ""
    duration_ms: int = 0
    #: Which line of the *source that was run* the fault was reported against,
    #: 1-based, or None when there is not one.
    #:
    #: Deliberately relative to what was handed in rather than to anything the
    #: author has open: the source that was handed in is usually the bot's
    #: shared library with a block underneath it (`compose`), and only the
    #: caller that composed it knows which of the two an author is looking at.
    #: `compose.locate` is what turns this number back into a place.
    #:
    #: Absent for a syntax error: the module never compiles, so no frame of the
    #: author's code exists to name a line.
    line: int | None = None
