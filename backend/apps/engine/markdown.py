"""MarkdownV2, as the editor stores it, turned into the HTML Telegram parses.

The editor writes Telegram's own MarkdownV2 markers verbatim
(`frontend/src/features/flow-builder/lib/markdown.ts`), on the reasoning that
storing what Telegram receives leaves no dialect to translate. What was missing
was the other half of that bargain: nothing ever set `parse_mode`, so every
`*qalin*` an author typed reached the customer with its asterisks showing.

Sending it back as MarkdownV2 is the obvious repair and the wrong one. That
dialect reserves sixteen characters *everywhere*, including in ordinary prose —
an unescaped `.` is a hard `Bad Request: can't parse entities`, and "Matnni shu
yerga yozing." ends in one. The author's text is not escaped and cannot be
retroactively escaped without knowing which markers they meant. HTML reserves
three characters, all of which this module escapes as it goes, so a message with
no formatting in it survives untouched and a malformed marker degrades into the
literal character rather than into an error.

Only the markers the editor's own toolbar can produce are recognised. Anything
else is text.
"""

from __future__ import annotations

_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}

#: Inline markers, longest first — `__` has to be tried before `_`, or an
#: underline opens an italic and closes it on its own second character.
_WRAPPERS: list[tuple[str, str, str]] = [
    ("||", "<tg-spoiler>", "</tg-spoiler>"),
    ("__", "<u>", "</u>"),
    ("*", "<b>", "</b>"),
    ("_", "<i>", "</i>"),
    ("~", "<s>", "</s>"),
]


def _escape(text: str) -> str:
    return "".join(_ESCAPES.get(char, char) for char in text)


def _find(text: str, start: int, token: str) -> int:
    """Where `token` next appears, ignoring a backslash-escaped occurrence.

    Returns -1 when it does not close. An opener that never closes is left as
    the character the author typed: a lone `*` in "2 * 3" is multiplication.
    """
    index = start
    while index < len(text):
        if text[index] == "\\":
            index += 2
            continue
        if text.startswith(token, index):
            return index
        index += 1
    return -1


def _link(text: str, start: int) -> tuple[str, int] | None:
    """`[label](href)` at `start`, or None when the shape does not complete."""
    close = _find(text, start + 1, "]")
    if close == -1 or not text.startswith("(", close + 1):
        return None
    end = _find(text, close + 2, ")")
    if end == -1:
        return None
    label = text[start + 1 : close]
    href = text[close + 2 : end]
    if not label or not href:
        return None
    # The href is an attribute value, so the quote character has to go too —
    # the three `_escape` handles are not enough inside quotes.
    safe = _escape(href).replace('"', "&quot;")
    return f'<a href="{safe}">{_inline(label)}</a>', end + 1


def _inline(text: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]

        # A backslash means "the next character is not a marker" — the one way
        # an author writes a literal asterisk.
        if char == "\\" and index + 1 < len(text):
            out.append(_escape(text[index + 1]))
            index += 2
            continue

        # Code spans take no nested markers: what is inside them is meant to be
        # read as typed, which is the whole point of marking it as code.
        if text.startswith("```", index):
            close = _find(text, index + 3, "```")
            if close != -1 and close > index + 3:
                out.append(f"<pre>{_escape(text[index + 3 : close])}</pre>")
                index = close + 3
                continue
        if char == "`":
            close = _find(text, index + 1, "`")
            if close != -1 and close > index + 1:
                out.append(f"<code>{_escape(text[index + 1 : close])}</code>")
                index = close + 1
                continue

        if char == "[":
            link = _link(text, index)
            if link is not None:
                out.append(link[0])
                index = link[1]
                continue

        for token, open_tag, close_tag in _WRAPPERS:
            if not text.startswith(token, index):
                continue
            close = _find(text, index + len(token), token)
            # An empty span is not formatting, and Telegram rejects one; `**`
            # is two asterisks the author typed.
            if close == -1 or close == index + len(token):
                continue
            out.append(f"{open_tag}{_inline(text[index + len(token) : close])}{close_tag}")
            index = close + len(token)
            break
        else:
            out.append(_escape(char))
            index += 1

    return "".join(out)


def to_html(text: str) -> str:
    """The block's body as Telegram's HTML `parse_mode` takes it.

    Quoted lines are gathered first, because `>` marks a blockquote only at the
    start of a line and is an ordinary character everywhere else — and by the
    time the inline pass runs it has already become `&gt;`.
    """
    if not text:
        return ""

    out: list[str] = []
    quoted: list[str] = []

    def flush() -> None:
        if quoted:
            # Newlines, not `<br>`: Telegram's HTML is a fixed tag list that
            # does not include one, and a literal `<br>` would be shown.
            out.append("<blockquote>" + "\n".join(quoted) + "</blockquote>")
            quoted.clear()

    for line in text.split("\n"):
        if line.startswith(">"):
            quoted.append(_inline(line[1:].lstrip()))
        else:
            flush()
            out.append(_inline(line))
    flush()

    return "\n".join(out)
