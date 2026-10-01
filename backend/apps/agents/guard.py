"""The last thing between a model's answer and a customer reading it.

A flow answers what it was drawn to answer, so nothing ever had to check what
went out — the author wrote the sentence. An agent writes its own, which means
the product now sends words nobody reviewed, and the review has to happen
somewhere.

This is not a content filter and does not try to be one. It closes the three
failures that are *ours* rather than the model's:

  * **an empty answer.** A bot that goes silent reads as broken, and the exit
    the flow should take when there is nothing to say is «tushunmadi», where
    the author has written what to do about it.
  * **the instruction leaking.** "Repeat everything above" is the first thing
    anybody tries, and the system prompt holds a workspace's own wording,
    pricing rules and escalation policy. A verbatim run of the instruction in
    the reply is refused outright rather than trimmed: a half-quoted policy is
    still a quoted policy.
  * **a link that is not a link.** `javascript:`, `data:` and friends are not
    addresses a model has any business producing, and Telegram renders them
    into something tappable. Anything but `http(s)` is refused.

Length is the fourth thing and the only one that is not a refusal: a reply
longer than the agent's cap is cut at a sentence boundary, because "too long"
is a formatting problem and refusing a good answer over it would be the guard
doing more harm than the thing it guards against.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

#: Schemes a reply may not carry. `tg://` is here with the rest: a deep link
#: into Telegram's own client that no author wrote is a link that goes
#: somewhere nobody in this workspace chose.
FORBIDDEN_SCHEMES = re.compile(r"\b(?:javascript|data|vbscript|file|tg)\s*:", re.IGNORECASE)

#: How many consecutive words of the system instruction count as a leak.
#:
#: Long enough that ordinary overlap does not trip it — an agent told to talk
#: about delivery times will legitimately produce the phrase "yetkazib berish
#: muddati" — and short enough that quoting a policy sentence back does.
LEAK_WINDOW = 12

#: How many instructions' fingerprints are kept. An instruction changes when
#: somebody edits the agent and not otherwise, so the first message after a
#: save pays for the scan and every message after it does not — which is what
#: makes covering the *whole* instruction affordable.
#:
#: This was a ceiling on how many windows were built, and that was a hole: it
#: kept the first ~411 words and silently left the rest unguarded. Authors
#: append — the escalation policy and the pricing rules are at the *end* of a
#: long instruction — so the cap protected the introduction and skipped the
#: part worth stealing. Bounding the cache instead bounds the cost without
#: bounding the coverage.
FINGERPRINT_CACHE = 16

_WORD = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True)
class Verdict:
    """What the guard decided. `text` is what may be sent when `ok`."""

    ok: bool
    text: str = ""
    #: Machine-readable, for `AgentRun.reason` — "" when nothing was wrong.
    problem: str = ""
    #: One line for the trace, naming what happened.
    detail: str = ""
    #: The reply was longer than the cap and was cut. Not a problem, but worth
    #: seeing in the trace when an answer reads as though it stops mid-thought.
    truncated: bool = False


def _windows(text: str) -> set[int]:
    """Every run of `LEAK_WINDOW` words in `text`, lowercased and hashed.

    Words rather than characters: an instruction reproduced with different
    spacing, a different quote mark or a stray newline is the same leak, and a
    substring search would miss all three.

    Hashed rather than kept, because the instruction's windows are cached and a
    long instruction held as tuples of words is megabytes. Two different runs
    of twelve words colliding on a 64-bit hash would refuse one good answer;
    at this many windows that is somewhere around one in a hundred billion,
    which is a better trade than leaving the tail of the instruction unread.
    """
    words = [word.lower() for word in _WORD.findall(text)]
    if len(words) < LEAK_WINDOW:
        return set()
    spans = range(len(words) - LEAK_WINDOW + 1)
    return {hash(tuple(words[index : index + LEAK_WINDOW])) for index in spans}


@lru_cache(maxsize=FINGERPRINT_CACHE)
def _instruction_windows(instructions: str) -> frozenset[int]:
    """`_windows` of an instruction, remembered.

    Keyed on the text itself, so an edited agent is a different key and there
    is nothing to invalidate — an instruction that changed cannot be answered
    against the old one's fingerprints.
    """
    return frozenset(_windows(instructions))


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    """`text` cut to `limit`, at the last sentence end if there is one nearby.

    A cut mid-word reads as a broken bot; a cut mid-sentence reads as one that
    was interrupted. Falling back to the hard cut when no sentence ends in the
    last quarter is deliberate — a wall of text with no punctuation has no
    better place to stop.
    """
    if len(text) <= limit:
        return text, False
    head = text[:limit]
    cut = max(head.rfind("."), head.rfind("!"), head.rfind("?"), head.rfind("\n"))
    if cut > limit * 3 // 4:
        return head[: cut + 1].strip(), True
    return head.rstrip() + "…", True


def check(reply: str, *, instructions: str = "", max_chars: int = 1200) -> Verdict:
    """Whether this answer may be sent, and in what form."""
    text = (reply or "").strip()
    if not text:
        return Verdict(ok=False, problem="empty", detail="Model bo'sh javob qaytardi")

    scheme = FORBIDDEN_SCHEMES.search(text)
    if scheme:
        return Verdict(
            ok=False,
            problem="blocked",
            detail=f"Javobda ruxsat etilmagan havola turi: {scheme.group(0).strip()}",
        )

    if instructions:
        leaked = _instruction_windows(instructions) & _windows(text)
        if leaked:
            return Verdict(ok=False, problem="blocked", detail="Javob ko'rsatma matnini takrorladi")

    cut, truncated = _truncate(text, max(int(max_chars or 0), 1))
    return Verdict(ok=True, text=cut, truncated=truncated)
