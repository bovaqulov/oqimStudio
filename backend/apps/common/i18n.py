"""Which language a bot speaks, and picking one string out of several.

Uzbekistan is bilingual in practice: the same clinic answers one customer in
Uzbek and the next in Russian, and a great many phones here are set to Russian
regardless of what their owner speaks. So a block's text stops being one string
and becomes a map of them — `{"uz": "...", "ru": "..."}`.

Every flow saved before that shape existed still holds a bare string, and there
is no migration that could turn one into a translation. A plain string is
therefore read as the bot's own language, which makes the two shapes the same
thing to everything downstream: nothing written before this module existed
answers any differently after it.

Kept free of Django and of any app's models on purpose. `bots`, `contacts` and
`engine` all need these rules, and `contacts` already imports `bots` — a helper
living in either of them would either be unreachable from the other or would
close an import cycle, and one that lived in `engine` would put the runtime
between the editor and its own data.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

#: The languages a bot can be configured in. Uzbek is first because it is the
#: default and the last thing a lookup falls back to.
LANGUAGES: tuple[str, ...] = ("uz", "ru", "en")

#: What a bot speaks when nothing says otherwise.
DEFAULT_LANGUAGE = "uz"

#: How a language is named to the people using the studio, whose interface is
#: Uzbek — so "Ruscha", not "Русский".
LANGUAGE_LABELS: dict[str, str] = {"uz": "O'zbekcha", "ru": "Ruscha", "en": "Inglizcha"}

#: The contact variable holding a language the customer picked themselves. A
#: variable rather than a column: it is written by the same "Teg / o'zgaruvchi"
#: block and read by the same `{{...}}` placeholders as everything else a flow
#: collects, so a language question needs no new machinery to store its answer.
LANGUAGE_VARIABLE = "mijoz_tili"

#: Telegram's `language_code` -> the language the bot answers in.
#:
#: Only the codes that are not their own answer are listed. Kazakh, Kyrgyz and
#: Tajik map to Russian because that is the language those users are actually
#: served in here — offering them English instead would be correct by ISO code
#: and wrong at the counter. Everything unlisted falls to English, which is the
#: honest answer for "a language this bot was not written in".
TELEGRAM_LANGUAGES: dict[str, str] = {
    "uz": "uz",
    "ru": "ru",
    "kk": "ru",
    "ky": "ru",
    "tg": "ru",
}


def _clean(value: Any) -> str:
    """One stored value as text, or `""` when there is nothing to say.

    Whitespace counts as nothing: a translation field somebody opened and left
    with a stray space in it is an empty translation, and sending that space
    instead of the language the author did write is the bug this catches.
    """
    if value is None or isinstance(value, (Mapping, list, tuple, set, bool)):
        return ""
    text = value if isinstance(value, str) else str(value)
    return text if text.strip() else ""


def _primary_subtag(code: Any) -> str:
    """`ru-RU` -> `ru`, `uz_Latn` -> `uz`, anything unusable -> `""`.

    Loose because the tag reaches us from Telegram, from a stored setting and
    from a form, and only one of those three is ours to spell correctly.
    """
    if not isinstance(code, str):
        return ""
    return code.strip().lower().replace("_", "-").split("-")[0]


def normalise_language(code: Any, *, fallback: str = DEFAULT_LANGUAGE) -> str:
    """A language tag as one of `LANGUAGES`, or the fallback."""
    head = _primary_subtag(code)
    return head if head in LANGUAGES else fallback


def resolve_text(value: Any, language: str, *, fallback: str = DEFAULT_LANGUAGE) -> str:
    """The one string to send, out of whatever the editor stored.

    In order: the language asked for, the bot's own language, then any
    translation at all. The last step matters more than it looks — an author
    who wrote only the Russian half of a message means for it to be sent, and a
    bot that answers with an empty string instead is simply broken.
    """
    if not isinstance(value, Mapping):
        # A bare string is the bot's own language: that is what it was written
        # in, back when there was only one.
        return _clean(value)

    order = [language, fallback, *LANGUAGES, *value.keys()]
    seen: set[str] = set()
    for code in order:
        if not isinstance(code, str) or code in seen:
            continue
        seen.add(code)
        text = _clean(value.get(code))
        if text:
            return text
    return ""


def normalise_text(value: Any, *, main: str = DEFAULT_LANGUAGE) -> dict[str, str]:
    """The write side: whatever arrived, as a language map.

    The main language always gets a key, even an empty one, so a caller can
    tell "not translated yet" from "this bot does not speak that language" —
    and so the editor has a field to type into for the language the bot is
    supposed to answer in.

    Unknown keys are dropped rather than kept: text under a tag nothing maps to
    can never be selected by `resolve_text`, so keeping it would only give an
    author somewhere to write a message that is never sent.
    """
    main = normalise_language(main)
    texts: dict[str, str] = {main: ""}
    if isinstance(value, Mapping):
        for code, text in value.items():
            if isinstance(code, str) and code in LANGUAGES:
                texts[code] = _clean(text)
    else:
        texts[main] = _clean(value)
    # Empty translations other than the main one are not stored: they say
    # nothing `resolve_text` does not already do, and they would grow every
    # saved graph by one key per language per block.
    return {code: text for code, text in texts.items() if text or code == main}


def language_from_telegram(
    code: Any,
    *,
    enabled: Iterable[str] | None = None,
    fallback: str = DEFAULT_LANGUAGE,
) -> str:
    """Which of the bot's languages to greet an unknown person in.

    A guess, and only ever the first one: it is overridden the moment the
    customer picks a language themselves. Narrowed to what the bot actually has
    enabled, because answering in a language the author wrote no text for just
    means falling back message by message.

    Telegram omits `language_code` often enough that it is not an edge case —
    an account that never set one, or an update that carries no user at all.
    The bot's own language answers for those, not English.
    """
    speaks = list(enabled) if enabled is not None else list(LANGUAGES)
    speaks = [item for item in speaks if item in LANGUAGES]
    fallback = normalise_language(fallback)
    if fallback not in speaks:
        # The main language is spoken whatever the list says — a bot with an
        # empty or misconfigured list still has to answer somebody.
        speaks.append(fallback)

    head = _primary_subtag(code)
    if not head:
        return fallback
    guess = TELEGRAM_LANGUAGES.get(head, "en")
    return guess if guess in speaks else fallback


def contact_language(contact, bot=None) -> str:
    """The language this bot speaks to this person in.

    The order is the product's, and the first step is the one that matters: a
    customer who has told the bot which language they want is not asked again
    and is not second-guessed by their phone's setting, which is frequently
    Russian on a phone belonging to somebody who answers in Uzbek.

    Takes the records rather than their fields so that callers — the runtime,
    the contact list, the CSV — cannot each apply a slightly different order.
    """
    bot = bot or contact.bot
    languages = bot.languages
    main = normalise_language(languages.get("main"))
    enabled = languages.get("enabled") or [main]

    chosen = normalise_language((contact.variables or {}).get(LANGUAGE_VARIABLE), fallback="")
    if chosen in enabled:
        return chosen
    return language_from_telegram(contact.language_code, enabled=enabled, fallback=main)
