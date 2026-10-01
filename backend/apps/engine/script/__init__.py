"""The script sandbox — an author's JavaScript, run with nothing to reach.

`sandbox` holds the mechanism, `limits` holds the contract and `compose` holds
the one thing a caller has to do before either: joining the bot's shared library
to the block's own source, and keeping the map that turns a reported line back
into a place the author can see. `concurrency` is the one limit that is not
about a single script — how many may run at once and whose they are — and it is
applied inside `run_script`, so a caller only has to say which workspace to
charge. Callers want those things and never the modules, so all of it is
re-exported here.
"""

from .compose import (
    BLOCK,
    DEFAULT_VARIABLE,
    FLOW,
    LIBRARY,
    ComposedScript,
    ScriptOrigin,
    compose,
    locate,
)
from .concurrency import Lease, acquire, lease_seconds, release, slot
from .limits import BUSY, FAILURE_KINDS, ScriptLimits, ScriptResult
from .sandbox import check_syntax, is_available, run_script, syntax_line

__all__ = [
    "BLOCK",
    "BUSY",
    "DEFAULT_VARIABLE",
    "FAILURE_KINDS",
    "FLOW",
    "LIBRARY",
    "ComposedScript",
    "Lease",
    "ScriptLimits",
    "ScriptOrigin",
    "ScriptResult",
    "acquire",
    "check_syntax",
    "compose",
    "is_available",
    "lease_seconds",
    "locate",
    "release",
    "run_script",
    "syntax_line",
    "slot",
]
