"""Turning one block into one Bot API call.

The editor stores a block the way an author thinks about it ("a photo with a
caption and two buttons"); Telegram wants a method name and a flat payload.
This module is the only place that knows the mapping, so a new content kind is
an entry in `CONTENT_METHODS` and nothing else.

See https://core.telegram.org/bots/api#available-methods
"""

from __future__ import annotations

import re
from typing import Any

from apps.common.i18n import DEFAULT_LANGUAGE, LANGUAGES, normalise_language, resolve_text
from apps.telegram.client import TelegramClient

from . import expressions
from .markdown import to_html

#: Callback data of a row that re-enters the bot at a command rather than
#: leaving a graph through one of its ports — the Menyu block's «Bosh menyu».
#:
#: It lived in `engine.fallback` while the bot's safety-net menu used it too.
#: That menu is gone; this row is not, because an author drew it.
COMMAND_PREFIX = "cmd:"

#: contentKind -> (Bot API method, the payload field the file goes in).
CONTENT_METHODS: dict[str, tuple[str, str | None]] = {
    "text": ("sendMessage", None),
    "photo": ("sendPhoto", "photo"),
    "video": ("sendVideo", "video"),
    "audio": ("sendAudio", "audio"),
    "voice": ("sendVoice", "voice"),
    "document": ("sendDocument", "document"),
    "animation": ("sendAnimation", "animation"),
    "location": ("sendLocation", None),
    "contact": ("sendContact", None),
    "poll": ("sendPoll", None),
    "invoice": ("sendInvoice", None),
    "album": ("sendMediaGroup", None),
    "copy": ("copyMessage", None),
}

#: contentKind -> the method that rewrites a message already on screen.
#:
#: Not every kind has one, and the gaps are the point: `sendMediaGroup` puts out
#: several messages and `sendInvoice` puts out one nothing can touch, so there
#: is no single message for an edit to name. `engine.transitions` is what refuses
#: those before it gets here; this table only says which call to make once the
#: decision is taken.
#:
#: A media kind maps to `editMessageMedia` rather than to a per-kind method
#: because the Bot API has none — the kind travels inside the `media` object as
#: its `type`, which is also how one call manages to replace a text message with
#: a photo.
EDIT_METHODS: dict[str, str] = {
    "text": "editMessageText",
    "photo": "editMessageMedia",
    "video": "editMessageMedia",
    "audio": "editMessageMedia",
    "document": "editMessageMedia",
    "animation": "editMessageMedia",
}

#: Buttons Telegram only accepts on an inline keyboard — a reply-keyboard
#: button is plain text the user sends back, so it can carry no payload.
#:
#: `webapp` used to be in here and is not a member: `KeyboardButton` has a
#: `web_app` field of its own. Which keyboard it goes on is not a formatting
#: choice — it decides whether the app can answer at all (see
#: `REPLY_PINNED_KINDS`).
INLINE_ONLY_KINDS = {"url", "login", "switch_inline", "copy"}

#: The mirror set: `request_contact` / `request_location` are `KeyboardButton`
#: powers, and an inline keyboard has no equivalent of either.
REPLY_ONLY_KINDS = {"request_contact", "request_location"}

#: Kinds that settle the keyboard even though both kinds of keyboard accept them.
#:
#: One member, and the whole Web App module rests on it. Telegram takes
#: `web_app` on an inline button and on a keyboard button, but the two open
#: different apps:
#:
#:   KeyboardButton.web_app — "The Web App will be able to send a
#:   'web_app_data' service message."
#:   InlineKeyboardButton.web_app — "The Web App will be able to send an
#:   arbitrary message on behalf of the user using the method
#:   answerWebAppQuery."
#:
#: and the client-side rule is blunter still: `sendData` "is only available for
#: Mini Apps launched via a Keyboard button". An inline Mini App button
#: therefore opens a page that can never reach the flow that sent it — which is
#: not a keyboard the author should be able to draw by accident. So a block
#: carrying one goes out as a reply keyboard whatever `buttonMode` says, the
#: same way a share row does. Mirrored by `buttonModeLock` in the editor.
#: https://core.telegram.org/bots/api#keyboardbutton
#: https://core.telegram.org/bots/webapps
REPLY_PINNED_KINDS = REPLY_ONLY_KINDS | {"webapp"}

#: Bot API 9.4's button `style`, exactly as the docs enumerate it: "Must be one
#: of “danger” (red), “success” (green) or “primary” (blue)." Anything else is
#: dropped rather than sent — Telegram answers an unknown style by refusing the
#: whole message, and a typo'd color must not cost a customer their answer.
BUTTON_STYLES = {"danger", "success", "primary"}


def _apply_button_style(payload: dict[str, Any], button: dict) -> dict[str, Any]:
    """Adds the button's color when it names a real one; omitted means the
    app's own theme, which is also what an invalid value degrades to."""
    style = button.get("style")
    if style in BUTTON_STYLES:
        payload["style"] = style
    return payload

#: One `{{ name }}` reference, with an optional filter chain after it.
#:
#: The name is matched strictly and the filters loosely, because the two fail
#: differently: a mistyped *name* has to stay on screen for the author to see
#: (there is no way to guess what they meant), while a mistyped *filter* is a
#: known list and can be reported.
VARIABLE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*((?:\|[^}]*)?)\}\}")

#: The characters `engine.markdown` reads as formatting.
#:
#: A *value* must never carry meaning into the author's text. A customer called
#: "Ali*bek" was turning the rest of the message italic, and one whose name held
#: an unclosed bracket produced `can't parse entities` — a message Telegram
#: refuses outright, so the customer got nothing at all and the trace recorded a
#: send that never happened.
#:
#: A backslash is exactly how the module already says "not a marker" (see
#: `markdown._inline`), so this is not a second escaping scheme — it is the one
#: that is already there, applied to the half of the string the author did not
#: write. The backslash itself is in the set and therefore doubles first.
MARKUP_MARKERS = "\\|_*~`[]()>"


def neutralise_markup(value: str) -> str:
    """A substituted value, unable to format anything around it."""
    return "".join("\\" + char if char in MARKUP_MARKERS else char for char in value)


def _split_filters(raw: str) -> list[tuple[str, str]]:
    """`| default: "mehmon" | qisqartir: 40` as a list of (name, argument).

    Split by hand rather than with `str.split("|")` because an argument may
    contain the separator — `default: "ha|yo'q"` is a legitimate thing to write
    and splitting naively turns it into an unknown filter named `yo'q"`.
    """
    parts: list[str] = []
    current: list[str] = []
    quote = ""
    for char in raw:
        if quote:
            current.append(char)
            if char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
            current.append(char)
            continue
        if char == "|":
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))

    filters: list[tuple[str, str]] = []
    for part in parts:
        piece = part.strip()
        if not piece:
            continue
        name, _, argument = piece.partition(":")
        filters.append((name.strip().lower(), _unquote(argument.strip())))
    return filters


def _unquote(argument: str) -> str:
    if len(argument) >= 2 and argument[0] == argument[-1] and argument[0] in "\"'":
        return argument[1:-1]
    return argument


def _filter_default(value: Any, argument: str) -> Any:
    """The value, or `argument` when there is nothing worth showing.

    "Nothing worth showing" is deliberately wider than `None`: a contact whose
    surname was never asked for holds `""`, and one whose answer was a tapped
    space holds `" "`. All three produced "Salom, !" — a sentence with a hole in
    it that no author ever wrote and no reader can make sense of.
    """
    if value is None:
        return argument
    if isinstance(value, str) and not value.strip():
        return argument
    return value


#: Filters a template may use. A closed list on purpose: a filter is *code*, and
#: the rule this product runs on is that data is configurable and decisions are
#: not. Faza 2 adds entries here (`pul`, `sana`, `qisqartir`); nothing else has
#: to change for them to work.
FILTERS = {"default": _filter_default}


#: Blocks whose type settles what they send, whatever `contentKind` says.
#:
#: Two reasons a block is here. The invoice is its own type in the editor
#: rather than an entry in the content menu, so nothing would name its kind —
#: and a graph saved before that change, which still says `message` +
#: `contentKind: invoice`, has to mean the same thing. The rest send a text
#: message with a keyboard of their own, and reach this module carrying
#: whatever kind the block they were converted out of had: an album among
#: them, which Telegram sends with no `reply_markup` at all. A menu nobody can
#: tap is not a menu.
TYPE_CONTENT_KINDS = {
    "language": "text",
    "followup": "text",
}


def content_kind(node: dict) -> str:
    """What this block sends — its own type first, then the author's pick."""
    return TYPE_CONTENT_KINDS.get(node.get("type", "")) or node.get("contentKind") or "text"


#: Every authored body is converted to HTML rather than sent as MarkdownV2 —
#: see `engine.markdown` for why that direction and not the other one.
PARSE_MODE = "HTML"


#: What Telegram accepts, in characters, per field.
#:
#: These are counted *after* the template has expanded, which is the only moment
#: the number is knowable: "Salom {{ism}}" is eleven characters until somebody
#: with a long name writes in. Nothing checked them at all, so an over-long
#: message was refused by Telegram with `message is too long` — and since the
#: refusal arrives after the run has moved on, the customer simply got no answer
#: and the trace showed a send.
#:
#: https://core.telegram.org/bots/api#sendmessage
FIELD_LIMITS = {
    "text": 4096,
    "caption": 1024,
    "poll_question": 300,
    "poll_option": 100,
    "invoice_title": 32,
    "invoice_description": 255,
}

#: Marks a body that had to be cut, for the reader and for the trace alike.
TRUNCATION_MARK = "…"


def fit(text: str, limit: int) -> str:
    """`text`, cut to `limit` if it has to be, at a word boundary.

    Measured on the *source* rather than on the HTML, and that is a deliberate
    inequality rather than an approximation: `engine.markdown` only ever adds
    characters (`*qalin*` becomes `<b>qalin</b>`, `&` becomes `&amp;`) while
    Telegram counts the text a reader sees, which is what those expand back
    down to. Source length is therefore an upper bound on the counted length,
    and a body that fits here cannot fail there.

    Cutting mid-marker is safe by the same module's design: an opener that never
    closes is left as the character the author typed, so a truncated `*qalin`
    degrades to an asterisk rather than to a parse error.
    """
    if len(text) <= limit:
        return text
    room = limit - len(TRUNCATION_MARK)
    if room <= 0:
        return TRUNCATION_MARK[:limit]
    cut = text[:room]
    # Back up to whitespace when there is one nearby, so the cut lands between
    # words rather than inside one. "Buyurtmangi…" reads as a broken message;
    # "Buyurtmangiz qabul …" reads as a long one.
    space = cut.rfind(" ")
    # `> 0`, not `>= 0`: `rfind` answers -1 when there is no space at all, and a
    # bare -1 read as an index quietly drops the last character of a body that
    # was one long word. Its own test caught that.
    if space > 0 and space >= room - 40:
        cut = cut[:space]
    return cut.rstrip() + TRUNCATION_MARK


def render_text(text: Any, context: dict[str, Any], *, markup: bool = False) -> str:
    """Picks the language, then fills `{{ism}}` placeholders from the context.

    In that order, and the order is the point. A translated field is a map of
    strings (see `apps.common.i18n`), and the placeholders inside the Russian
    one have to expand just as the Uzbek one's do — substituting first would be
    substituting into a dict, and every `{{...}}` in a translated message would
    reach the customer as literal braces.

    Which language is a fact about the *run*, not about this string, so it
    travels in the context beside everything else the block can read. A bare
    string resolves to itself, so a field written before translations existed
    goes out exactly as it always did.

    An unknown name is left as it was written rather than blanked: a message
    reading "Salom {{ism}}" is a bug the author can see, while "Salom " is one
    they cannot. A `default` filter overrides that — a name the author has
    already said what to do about is not an unanswered question.

    A dotted name is looked up flat first and walked second (`_lookup`), so
    Telegram's `{{user.first_name}}` and a Kod block's `{{hisob.jami}}` both
    resolve although the context stores them quite differently.

    `markup=True` is for a string on its way through `engine.markdown`: values
    are neutralised so a customer's own name cannot open a bold span or break
    the message. It is *not* the default, because most callers here send plain
    text — a poll option, a venue address, the trace line a step records — and a
    backslash in those is a backslash the reader sees. `render_markup` pairs the
    flag with the conversion so the two cannot come apart.

    Substitution happens exactly once and the result is never re-scanned, which
    is what keeps a value holding `{{...}}` from expanding into anything.
    """

    def replace(match: re.Match[str]) -> str:
        name, filter_source = match.group(1), match.group(2)
        filters = _split_filters(filter_source) if filter_source else []

        value = _lookup(context, name)
        for filter_name, argument in filters:
            handler = FILTERS.get(filter_name)
            # An unknown filter leaves the value alone rather than failing the
            # send. The author is told at save time; the customer waiting for
            # this message is not the person who can act on it.
            if handler is not None:
                value = handler(value, argument)

        # Still nothing: the name is not in the context and no filter supplied a
        # replacement, so the placeholder stays visible for the author to find.
        if value is None:
            return match.group(0)
        rendered = str(value)
        return neutralise_markup(rendered) if markup else rendered

    chosen = resolve_text(
        text,
        context.get("language") or "",
        fallback=context.get("language_fallback") or DEFAULT_LANGUAGE,
    )
    # Expressions first, names second, and neither result is re-scanned.
    #
    # In that order because an expression is the outer thing: `{{ money(jami) }}`
    # is one placeholder whose *source* mentions a variable, not a placeholder
    # containing another one. Names first would leave `money(690000)` sitting in
    # the text as something the expression pass no longer recognises — the call
    # is gone and only its argument's value is left.
    chosen = expressions.substitute(chosen, context, escape=neutralise_markup if markup else None)
    return VARIABLE_PATTERN.sub(replace, chosen)


def _lookup(context: dict[str, Any], name: str) -> Any:
    """`name` out of the context, flat key first and then down the dots.

    Both, and in that order, because the context holds two shapes and always
    has. Telegram's own fields are stored under keys that *contain* a dot —
    `context["user.first_name"]` — so a walker alone would stop finding them.
    Blocks that answer with a structure store the structure: the HTTP block puts
    a parsed body under `http`, and a Kod block puts whatever it returned under
    its own name, so `{{http.status}}` and `{{hisob.jami}}` have to walk.

    The flat key wins where both exist, which keeps every message written before
    this rendering exactly as it did.
    """
    if name in context:
        return context[name]
    if "." not in name:
        return None

    value: Any = context
    for part in name.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, (list, tuple)) and part.isdigit():
            index = int(part)
            value = value[index] if index < len(value) else None
        else:
            return None
        if value is None:
            return None
    return value


def render_markup(text: Any, context: dict[str, Any]) -> str:
    """An authored body, rendered and converted, in the one order that is safe.

    Two steps that must never be taken apart: substitute with the values
    neutralised, *then* read the author's markers. Done the other way — or with
    the neutralising left out — the customer's own text decides how the
    message is formatted, which is how "Ali*bek" italicised a paragraph he had
    never seen.
    """
    return to_html(render_text(text, context, markup=True))


def _mini_app_url(button: dict, context: dict[str, Any]) -> str:
    """Where a Web App button opens: the address the author wrote, and nothing else.

    There was a default here once — this product served a Mini App of its own
    and an empty `value` meant that one. It does not any more, so an empty
    value is an unfinished button and resolves to an empty string; the caller
    is what decides whether to draw it.
    """
    return str(button.get("value") or "").strip()


def _button_payload(button: dict, context: dict[str, Any]) -> dict[str, Any] | None:
    """One button as Telegram takes it.

    The label goes through `render_text` like any other thing a customer reads:
    a Russian message under Uzbek buttons is a half-translated bot, which is
    worse than an untranslated one because it looks like a mistake rather than
    a setting.
    """
    kind = button.get("kind", "callback")
    label = render_text(button.get("label", ""), context)
    value = button.get("value", "")
    if kind == "url":
        return _apply_button_style({"text": label, "url": value}, button) if value else None
    if kind == "webapp":
        url = _mini_app_url(button, context)
        return _apply_button_style({"text": label, "web_app": {"url": url}}, button) if url else None
    if kind == "login":
        return _apply_button_style({"text": label, "login_url": {"url": value}}, button) if value else None
    if kind == "switch_inline":
        return _apply_button_style({"text": label, "switch_inline_query": value}, button)
    if kind == "copy":
        return _apply_button_style({"text": label, "copy_text": {"text": value}}, button) if value else None
    # A callback button routes back into the flow, so its data is the port the
    # answer leaves through — that is what `dispatch` looks the edge up by.
    # The reply-only request kinds land here too: an inline keyboard cannot ask
    # for a share, so on the rare graph that pins the keyboard inline while
    # carrying one, the row still exists and still routes — it just cannot
    # hand over the number. The editor warns about that mismatch separately.
    return _apply_button_style(
        {"text": label, "callback_data": f"{BUTTON_PREFIX}{button.get('id', '')}"}, button
    )




def effective_button_mode(node: dict) -> str:
    """The keyboard type this node actually goes out with.

    `build_keyboard` has always been allowed to overrule the stored
    `buttonMode` — a share row forces reply, an inline-only kind forces inline
    — but routing kept reading the stored field, so a graph saved as inline
    with a `request_contact` button *sent* a reply keyboard whose taps then
    matched nothing: the share landed in the fallback and the run stayed
    parked forever. Whoever asks "what keyboard is this" asks here, the same
    answer the customer's screen shows. Mirrors `effectiveButtonMode` in the
    editor.
    """
    # A block pinned to a reply keyboard by one of its buttons — a share row or
    # a keyboard Web App button — goes out as one whatever `buttonMode` says.
    buttons = node.get("buttons") or []
    if any(button.get("kind") in REPLY_PINNED_KINDS for button in buttons):
        return "reply"
    mode = node.get("buttonMode") or "inline"
    if mode == "reply" and any(button.get("kind") in INLINE_ONLY_KINDS for button in buttons):
        return "inline"
    return mode


def _reply_button_payload(button: dict, context: dict[str, Any]) -> dict[str, Any]:
    """One `KeyboardButton`. Plain text, unless the kind asks for something more."""
    payload: dict[str, Any] = {"text": render_text(button.get("label", ""), context)}
    kind = button.get("kind", "")
    if kind == "request_contact":
        payload["request_contact"] = True
    elif kind == "request_location":
        payload["request_location"] = True
    elif kind == "webapp":
        # The row that makes the Web App module a round trip rather than a
        # link: a Mini App opened from *this* button — and from no other kind
        # of button — may call `sendData`, which arrives as the
        # `web_app_data` service message `events.parse_update` reads.
        #
        # A row with no address is left as plain text rather than dropped. A
        # `KeyboardButton` with an empty `web_app.url` is refused by the Bot
        # API, and refusing the whole message would cost the customer every
        # other row on the keyboard as well.
        url = _mini_app_url(button, context)
        if url:
            payload["web_app"] = {"url": url}
    return _apply_button_style(payload, button)


#: `sendMediaGroup` is the one method that accepts no `reply_markup` at all.
BUTTONLESS_CONTENT = {"album"}

#: Telegram Stars: `sendInvoice` with this currency takes an empty
#: `provider_token`, so a bot can charge without a merchant account at all.
STARS_CURRENCY = "XTR"


#: Callback data of an invoice's "Bekor" row. Not a `btn:` port — it is the
#: block's own second exit, the way "yes"/"no" are a condition's.
CANCEL_DATA = "port:cancelled"




#: The row a block ends with when the author gave it a way back, and what it
#: says when they did not rename it. Mirrors the editor's `BACK_ROW_LABEL`.
#:
#: A port and not a `btn:` id for the same reason "Bekor" and "O'tkazib
#: yuborish" are: it is the block's own exit rather than one of the author's
#: buttons, so it survives every edit to the keyboard above it. And like them
#: it carries nothing at all on a reply keyboard, which is why `dispatch`
#: matches the label there as well as the callback here.
BACK_DATA = "port:back"
BACK_LABEL = "⬅️ Orqaga"

#: A rating and a language button both leave through the block's one exit, so
#: what the callback carries is the answer rather than the port: the score that
#: was tapped, the language that was picked.
#: Callback data of a row that is one of the *author's* buttons, ahead of the
#: button's own id. Its own constant because three modules spell it: this one
#: writes it, `dispatch` reads it back off the tap, and `runner` uses it to
#: find the label the customer actually pressed.
BUTTON_PREFIX = "btn:"

LANGUAGE_PREFIX = "lang:"



#: What each language calls itself. Deliberately not `i18n.LANGUAGE_LABELS`:
#: those name a language to the author, in the studio's Uzbek ("Ruscha"),
#: while this row is read by the customer — who is looking for the word in
#: their own language, not in somebody else's.
LANGUAGE_ENDONYMS = {"uz": "🇺🇿 O'zbekcha", "ru": "🇷🇺 Русский", "en": "🇬🇧 English"}

#: Default wording and target of a menu's home row, mirroring the editor's
#: `MENU_HOME_LABEL` / `MENU_HOME_COMMAND`.
MENU_HOME_LABEL = "🏠 Bosh menyu"
MENU_HOME_COMMAND = "start"


def language_options(node: dict, enabled: list[str] | None = None) -> list[dict]:
    """The languages this block offers, narrowed to what the bot speaks.

    A button for a language nobody wrote any text in writes `mijoz_tili` and
    changes nothing else, which reads to the customer as a bot that ignored
    them — so the bot's own list has the last word, and the block only supplies
    the wording. A block listing none, or listing only languages the bot has
    switched off, falls back to that list rather than to an empty keyboard: a
    question nobody can answer parks the run for good.
    """
    speaks = [code for code in (enabled or LANGUAGES) if code in LANGUAGES]
    authored: dict[str, str] = {}
    for option in (node.get("language") or {}).get("options") or []:
        code = normalise_language(option.get("code"), fallback="")
        if code and code not in authored:
            authored[code] = (option.get("label") or "").strip()
    ordered = [code for code in authored if code in speaks] or speaks
    return [{"code": code, "label": authored.get(code) or LANGUAGE_ENDONYMS.get(code, code)} for code in ordered]


def back_row_label(node: dict, context: dict[str, Any] | None = None) -> str:
    """What the block's back row says, rendered for this run's language.

    Its own function because `dispatch` needs the very same string: on a reply
    keyboard the row carries no payload, so the label *is* how a tap on it is
    recognised.
    """
    if node.get("back") is None:
        return ""
    return render_text(node.get("back"), context or {}).strip() or BACK_LABEL


def _back_row(node: dict, mode: str, context: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """The block's own way back, on a row of its own under everything else."""
    label = back_row_label(node, context)
    if not label:
        return None
    return {"text": label} if mode == "reply" else {"text": label, "callback_data": BACK_DATA}


def _cancel_label(node: dict, context: dict[str, Any]) -> str:
    """What the way-out row says. The author may rename it on the block."""
    return render_text((node.get("invoice") or {}).get("cancelLabel"), context) or "Bekor qilish"


def _pay_label(node: dict) -> str:
    """What the Pay button says. The amount, when the block names one."""
    invoice = node.get("invoice") or {}
    amount = str(invoice.get("amount") or "").strip()
    currency = invoice.get("currency") or "UZS"
    return f"To'lash · {amount} {currency}".strip() if amount else "To'lash"


def build_keyboard(node: dict, context: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """The `reply_markup` for a block, or None when it has no keyboard.

    Buttons are stored flat with a `sameRow` flag; Telegram wants rows. The
    rows are rebuilt here so ordering, ids and per-button ports stay untouched
    by layout.

    `context` is what every label on the keyboard is rendered against — the
    run's language and its variables. It is optional only so that a caller with
    nothing to say about either still gets a keyboard; the runtime always has
    one, because a keyboard in a different language from the message above it
    is the one half-translation a customer cannot miss.
    """
    context = context if context is not None else {}
    kind = content_kind(node)
    if kind in BUTTONLESS_CONTENT:
        return None
    buttons = node.get("buttons") or []

    # An invoice's keyboard is Telegram's, not the author's: "If not empty, the
    # first button must be a Pay button." Sending the author's buttons on their
    # own replaces the Pay button with something that cannot take money, so the
    # Pay row is put back in front of them.
    # https://core.telegram.org/bots/api#sendinvoice
    if kind == "invoice":
        rows: list[list[dict[str, Any]]] = [[{"text": _pay_label(node), "pay": True}]]
        for button in buttons:
            payload = _button_payload(button, context)
            if payload is not None:
                rows.append([payload])
        # An invoice with only a Pay button is a conversation with no way out:
        # a customer who changes their mind has nothing to tap, and the run
        # sits parked forever. The block's own "Bekor" exit is offered as a
        # row, so the branch the author drew is reachable — and where they drew
        # none, the run still ends instead of hanging.
        rows.append([{"text": _cancel_label(node, context), "callback_data": CANCEL_DATA}])
        # "Bekor" abandons the purchase; «Orqaga» goes back to whatever offered
        # it. Two exits the card draws separately, so both are sent — the rule
        # quoted above binds the *first* button and nothing after it.
        back = _back_row(node, "inline", context)
        if back is not None:
            rows.append([back])
        return {"inline_keyboard": rows}

    if node.get("type") == "language":
        return {
            "inline_keyboard": [
                [{"text": option["label"], "callback_data": f"{LANGUAGE_PREFIX}{option['code']}"}]
                for option in language_options(node)
            ]
        }

    mode = effective_button_mode(node)

    back = _back_row(node, mode, context)
    # A block whose only row is the back row still has a keyboard — leaving it
    # out here would draw the row in the editor and send nothing.
    if not buttons and back is None:
        return None

    rows = []
    for button in buttons:
        payload = _reply_button_payload(button, context) if mode == "reply" else _button_payload(button, context)
        if payload is None:
            continue
        if button.get("sameRow") and rows:
            rows[-1].append(payload)
        else:
            rows.append([payload])

    # Last of all, under the choices: it is the way out of the block, and a way
    # out that sits between two choices reads as a third choice.
    if back is not None:
        rows.append([back])

    if not rows:
        return None
    if mode == "reply":
        return {"keyboard": rows, "resize_keyboard": True}
    return {"inline_keyboard": rows}


def _media_value(node: dict) -> str:
    source = node.get("mediaSource") or {}
    return source.get("value", "")


#: contentKind -> the word the author sees for it, for a sentence about a block
#: that cannot be sent. Only the kinds that carry a file need one.
_MEDIA_LABELS: dict[str, str] = {
    "photo": "Rasm",
    "video": "Video",
    "audio": "Audio",
    "voice": "Ovozli xabar",
    "document": "Fayl",
    "animation": "GIF",
}


def missing_media(node: dict) -> str | None:
    """Why this block cannot be sent, or None when it can.

    A block whose content kind puts a file in the payload — `sendDocument`,
    `sendPhoto` and the rest — is not sendable with that field empty: Telegram
    refuses the call, and it refuses it with a message about a parameter rather
    than about the block. Asked *before* the call so the run can say which block
    and what is missing, in the author's own words.

    It matters most where nothing is actually sent. A test run from the editor
    builds the payload and stops, so an unfinished media block came back as a
    plain caption bubble followed by "Suhbat yakunlandi" — the editor reporting
    a healthy conversation for a block that cannot leave the machine.
    """
    kind = content_kind(node)
    method, media_field = CONTENT_METHODS.get(kind, ("sendMessage", None))
    if not media_field or _media_value(node).strip():
        return None
    label = _MEDIA_LABELS.get(kind, kind)
    return f"«{label}» blokiga fayl biriktirilmagan — {method} fayl bilan yuboriladi."


def build_call(
    node: dict,
    chat_id: int | str,
    context: dict[str, Any],
    business_connection_id: str = "",
    provider_token: str = "",
    edit_message_id: int | None = None,
) -> tuple[str, dict[str, Any]]:
    """The method name and payload this block sends.

    `provider_token` is only read by an invoice, and only the caller can find
    it: it belongs to the bot's payment connection, and this module is given a
    block rather than a bot.

    `edit_message_id` rewrites the message with that id instead of sending a
    new one. The payload is built exactly the same way either way and converted
    at the end, so a block goes out with the same text, the same keyboard and
    the same rendering whichever way it is delivered — the alternative was two
    builders drifting apart one content kind at a time. Whether an edit is
    allowed at all is `engine.transitions`; by here it has been decided.
    """
    kind = content_kind(node)
    method, media_field = CONTENT_METHODS.get(kind, ("sendMessage", None))
    # Rendered once, then cut to whichever field it is about to become: the same
    # body is a 4096-character message and a 1024-character caption depending on
    # nothing but the block's content kind.
    body = render_text(node.get("text", ""), context, markup=True)
    markup = build_keyboard(node, context)

    payload: dict[str, Any] = {"chat_id": chat_id}
    if business_connection_id:
        payload["business_connection_id"] = business_connection_id

    if kind == "text":
        payload["text"] = to_html(fit(body, FIELD_LIMITS["text"]))
        payload["parse_mode"] = PARSE_MODE
    elif media_field:
        payload[media_field] = _media_value(node)
        if body:
            payload["caption"] = to_html(fit(body, FIELD_LIMITS["caption"]))
            payload["parse_mode"] = PARSE_MODE
    elif kind == "location":
        location = node.get("location") or {}
        payload.update({"latitude": location.get("latitude"), "longitude": location.get("longitude")})
        # Through `render_text`, not raw: a venue's name and address are copy an
        # author writes, so they carry translations like every other authored
        # string — and a `{"uz": …, "ru": …}` map put into the payload
        # untouched would reach Telegram as a dict.
        title = render_text(location.get("title"), context)
        if title:
            # Telegram turns a named point into a venue, which needs both fields.
            payload.update({"title": title, "address": render_text(location.get("address"), context)})
    elif kind == "contact":
        contact = node.get("contact") or {}
        payload.update(
            {
                "phone_number": contact.get("phoneNumber", ""),
                "first_name": contact.get("firstName", ""),
                "last_name": contact.get("lastName", ""),
            }
        )
    elif kind == "poll":
        poll = node.get("poll") or {}
        options = [
            fit(render_text(option.get("text", ""), context), FIELD_LIMITS["poll_option"])
            for option in poll.get("options", [])
        ]
        payload.update(
            {
                "question": fit(render_text(poll.get("question", ""), context), FIELD_LIMITS["poll_question"]),
                "options": options,
                "is_anonymous": poll.get("isAnonymous", True),
                "allows_multiple_answers": poll.get("allowsMultipleAnswers", False),
                "type": "quiz" if poll.get("isQuiz") else "regular",
            }
        )
        if poll.get("isQuiz"):
            correct = poll.get("correctOptionId")
            ids = [option.get("id") for option in poll.get("options", [])]
            payload["correct_option_id"] = ids.index(correct) if correct in ids else 0
    elif kind == "invoice":
        invoice = node.get("invoice") or {}
        currency = invoice.get("currency") or "UZS"
        # The Bot API takes the smallest currency unit as an integer; the editor
        # holds a human-readable decimal string. Stars are the exception —
        # `XTR` has no subunit, so one star is 1 and not 100.
        try:
            raw = float(invoice.get("amount") or 0)
        except (TypeError, ValueError):
            raw = 0.0
        amount = int(round(raw)) if currency == STARS_CURRENCY else int(round(raw * 100))
        # Telegram's tightest fields by far — 32 and 255. A title assembled from
        # a course name and a customer's own words overruns one of them easily,
        # and the whole invoice is refused when it does, which is a payment that
        # never gets offered.
        title = fit(render_text(invoice.get("title", ""), context), FIELD_LIMITS["invoice_title"])
        payload.update(
            {
                "title": title,
                "description": fit(
                    render_text(invoice.get("description", ""), context),
                    FIELD_LIMITS["invoice_description"],
                ),
                "payload": invoice.get("payload") or node.get("id", "invoice"),
                "currency": currency,
                "prices": [{"label": title or "To'lov", "amount": amount}],
                # Required for every currency. Stars need it present and empty;
                # a card provider needs the merchant token the bot is connected
                # with, which the caller looks up because only it knows the bot.
                "provider_token": "" if currency == STARS_CURRENCY else (provider_token or ""),
            }
        )
    elif kind == "album":
        payload["media"] = [
            {
                "type": item.get("kind", "photo"),
                "media": (item.get("source") or {}).get("value", ""),
                "caption": fit(
                    render_text(item.get("caption", ""), context), FIELD_LIMITS["caption"]
                ),
            }
            for item in node.get("album") or []
        ]
    elif kind == "copy":
        source = _copy_source(node.get("copyLink", ""))
        if source:
            payload.update(source)

    if markup:
        payload["reply_markup"] = markup
    if edit_message_id is not None:
        return _as_edit(kind, payload, edit_message_id)
    return method, payload


def _as_edit(kind: str, payload: dict[str, Any], message_id: int) -> tuple[str, dict[str, Any]]:
    """The same message, addressed at one already on screen.

    `editMessageMedia` is the awkward one: the flat `photo`/`video`/… field and
    the caption beside it have to fold into a single `InputMedia` object, whose
    `type` is what tells Telegram which of them this is. That folding is the
    whole reason one call can turn a text message into a photo — there is no
    `editMessagePhoto` to reach for.

    A reply keyboard is dropped rather than sent: `reply_markup` on every edit
    method is typed `InlineKeyboardMarkup`, and Telegram refuses the call rather
    than ignoring the field. `transitions.accepts_inline_keyboard` keeps this
    from arising; the guard is here because a payload that costs a customer
    their answer is not worth one shared assumption between two modules.
    """
    method = EDIT_METHODS[kind]
    edited: dict[str, Any] = {"chat_id": payload["chat_id"], "message_id": message_id}
    if payload.get("business_connection_id"):
        edited["business_connection_id"] = payload["business_connection_id"]

    markup = payload.get("reply_markup")
    if isinstance(markup, dict) and "inline_keyboard" in markup:
        edited["reply_markup"] = markup

    if method == "editMessageText":
        edited["text"] = payload.get("text", "")
        edited["parse_mode"] = payload.get("parse_mode", PARSE_MODE)
        return method, edited

    media: dict[str, Any] = {"type": kind, "media": payload.get(CONTENT_METHODS[kind][1] or kind, "")}
    if payload.get("caption"):
        media["caption"] = payload["caption"]
        media["parse_mode"] = payload.get("parse_mode", PARSE_MODE)
    edited["media"] = media
    return method, edited


def build_delete_call(chat_id: int | str, message_id: int) -> tuple[str, dict[str, Any]]:
    """Takes a message off the screen.

    No `business_connection_id`: `deleteMessage` takes only the chat and the
    message, and sending a field the method does not declare is how a call gets
    refused outright. See https://core.telegram.org/bots/api#deletemessage
    """
    return "deleteMessage", {"chat_id": chat_id, "message_id": message_id}


def build_clear_markup_call(
    chat_id: int | str, message_id: int, business_connection_id: str = ""
) -> tuple[str, dict[str, Any]]:
    """Takes the keyboard off a message and leaves everything else alone.

    The middle transition, and the only one that needs no idea what the block
    below it says: `editMessageReplyMarkup` with no markup at all. The reader
    keeps what the bot told them and loses the rows they have already walked
    past — which is the half of "delete the old message" that is about a menu
    being tappable twice, without the half that erases the conversation.
    """
    payload: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id}
    if business_connection_id:
        payload["business_connection_id"] = business_connection_id
    return "editMessageReplyMarkup", payload


def _copy_source(link: str) -> dict[str, Any] | None:
    """Reads a `t.me` message link into `from_chat_id` + `message_id`.

    Two shapes exist: `t.me/<username>/<id>` for a public channel, and
    `t.me/c/<internal>/<id>` for a private one, whose chat id is the internal
    number behind a `-100` prefix.
    """
    parts = [part for part in link.split("/") if part]
    if len(parts) < 2 or not parts[-1].isdigit():
        return None
    owner = parts[-2]
    if len(parts) >= 3 and parts[-3] == "c" and owner.isdigit():
        return {"from_chat_id": int(f"-100{owner}"), "message_id": int(parts[-1])}
    return {"from_chat_id": f"@{owner}", "message_id": int(parts[-1])}


def send_node(
    client: TelegramClient,
    node: dict,
    chat_id: int | str,
    context: dict[str, Any],
    business_connection_id: str = "",
    provider_token: str = "",
    edit_message_id: int | None = None,
) -> dict[str, Any]:
    """Sends one block — or rewrites one already sent — and returns the trace."""
    method, payload = build_call(node, chat_id, context, business_connection_id, provider_token, edit_message_id)
    result = client.call(method, payload)
    return {"method": method, "payload": payload, "result": result}
