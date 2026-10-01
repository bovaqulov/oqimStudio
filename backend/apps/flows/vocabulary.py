"""The block vocabulary, in Python: every type, and the exits each one publishes.

Until now the backend barely knew what a block *was*. `serializers.GraphSerializer`
checked ids and edge endpoints and passed `type` and `port` through untouched,
which was defensible while the only writer was the editor — the editor cannot
draw a port that does not exist. It stopped being defensible the moment a graph
could be generated somewhere else and uploaded: `runner.execute` steps over a
type it does not know and `walk` finds no edge leaving a port nobody published,
so an invented `"port": "success"` is a bot that goes silent at that block, with
nothing anywhere saying why.

**This is the second copy.** The first is
`frontend/src/features/flow-builder/node-definitions.ts::NODE_TYPE_DEFINITIONS`,
which is the one the editor draws from and the one a new block type is added to
first. Two copies of an enumeration drift — that is the whole subject of
`.claude/skills/oqim-blok/` — so the pair is held together by
`tests_vocabulary_contract.py`, which reads the TypeScript and fails when the
two stop agreeing. Read that file before adding a type here.

What is deliberately *not* copied is anything the canvas needs and the runtime
does not: geometry, colour, icons, the `hasX` flags the Inspector places fields
off. A port is a contract between the two applications — an edge saved by one is
walked by the other — and a card's height is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: Prefix an edge leaving a keyboard button carries, ahead of the button's own
#: id. Mirrors `buttonPortId` in `flow-builder/lib/buttons.ts`; `dispatch`
#: routes a `callback_query` straight off this shape.
BUTTON_PORT_PREFIX = "btn:"

#: The block's own way back — one port, on the left edge of the card, published
#: only by a block that actually carries a back row (`node.back` is present).
#: `dispatch._reply_port` returns it for both a tapped inline row and the same
#: label typed off a reply keyboard.
BACK_PORT = "back"


@dataclass(frozen=True)
class BlockType:
    """One row of the vocabulary.

    `ports` is only what the type publishes *unconditionally*. Two kinds of exit
    are not fixed and cannot be: one per routable button, and the back row. Both
    are read off the block's own contents, which is why `published_ports` takes a
    node and this table does not try to list them.
    """

    type: str
    #: What the palette calls it — the name an author would recognise.
    label: str
    #: What a card's header says. Usually shorter than `label` ("Menyu" against
    #: "Menyu / Tugmalar"), and it is the one the findings quote.
    kind_label: str
    ports: tuple[str, ...]
    #: An update can open a flow at this block; nothing may route *into* it.
    #: `services.derive_triggers` mints a `FlowTrigger` from every one of them.
    entry: bool = False
    #: The flow owns this one: `node-registry.ts::applyEntryRule` keeps the
    #: first in a graph and deletes the rest on load. A graph carrying two is
    #: not a graph with an extra block, it is a graph that will lose one.
    owns_entry: bool = False
    #: Publishes `btn:<id>` per routable button — see `published_ports`.
    button_ports: bool = False
    #: Publishes `back` when the block carries a back row.
    back_port: bool = False
    #: What the body field is called on this block, or None where it has none.
    #: The findings quote it, so an author reads the name of the box they left
    #: empty rather than the word "text".
    body_label: str | None = None
    #: An empty body here produces nothing at run time. Everywhere else `text`
    #: is a label the card reads back and a blank one is a naming choice, not a
    #: fault — the same distinction `lib/validate-graph.ts::BODY_REQUIRED_TYPES`
    #: draws, widened to the two message-shaped blocks whose body *is* the
    #: message (guarded by content kind in `graph_validation`, since a photo's
    #: caption may perfectly well be empty).
    body_required: bool = False
    #: What an empty body actually costs on *this* block, said in one clause.
    #: Most of them simply send nothing; the two that send nothing anyway do
    #: something worse, and a warning that told a Shart author their block
    #: "sends nothing" would be describing a block that never sends anything.
    body_missing_hint: str = "bu blok hech nima yubormaydi"
    #: Field name -> one line saying what to put in it. This is what
    #: `GET /api/flows/schema/` hands to whoever is generating a graph
    #: elsewhere, so it is written for a reader who has never seen the editor.
    fields: dict[str, str] = field(default_factory=dict)


def _entry(type_: str, label: str, kind_label: str, *, owns: bool = False, fields: dict | None = None) -> BlockType:
    """An entry block: one exit, no input, and a trigger row derived from it."""
    return BlockType(
        type=type_,
        label=label,
        kind_label=kind_label,
        ports=("out",),
        entry=True,
        owns_entry=owns,
        fields=fields or {},
    )


#: Every block type the product has, keyed by the string a graph stores.
#:
#: Ordered the way `node-registry.ts::DEFAULT_NODE_TYPES` orders the palette
#: rather than alphabetically: `GET /api/flows/schema/` serialises this map in
#: order, and a list that opens with the entry blocks and ends with «Tugatish»
#: reads as the shape of a flow instead of as an index.
NODE_TYPES: dict[str, BlockType] = {
    "start": _entry(
        "start",
        "/start",
        "/start",
        owns=True,
    ),
    "trigger": _entry(
        "trigger",
        "Boshlanish sharti",
        "Boshlanish sharti",
        owns=True,
        fields={
            "dmsTrigger": (
                "Bot ichidagi oqim uchun shart: "
                "{kinds: [\"start\"|\"command\"|\"keyword\"|\"any\"|\"callback\"|\"photo\"|…], "
                "command: \"menu\" (slashsiz), keywords: \"har qatorda bitta so'z\", "
                "keywordMatch: \"exact\"|\"contains\"|\"regex\"}"
            ),
            "business": (
                "Business moduli uchun shart: {signal: \"new\", match: \"any\"|\"keyword\"|\"command\"|\"media\", "
                "command, keywords, keywordMatch, mediaKinds: [], schedule: {mode, days, from, to, timezone}}"
            ),
            "priority": "Bir nechta shart mos kelganda kichik raqam oldin ishlaydi. Yozilmasa shartdan chiqariladi.",
        },
    ),
    "groupjoin": _entry("groupjoin", "Yangi a'zo", "Yangi a'zo"),
    "groupleave": _entry("groupleave", "A'zo chiqdi", "A'zo chiqdi"),
    "joinrequest": _entry("joinrequest", "Qo'shilish so'rovi", "Qo'shilish so'rovi"),
    "channelpost": _entry("channelpost", "Yangi post", "Yangi post"),
    "message": BlockType(
        type="message",
        label="Xabar",
        kind_label="Xabar",
        ports=("out",),
        button_ports=True,
        back_port=True,
        body_label="Matn",
        body_required=True,
        fields={
            "text": "Mijozga yuboriladigan matn. `{{ism}}` ko'rinishidagi o'zgaruvchilar qo'llanadi.",
            "contentKind": (
                "Nima yuboriladi: \"text\" (standart), \"photo\", \"video\", \"audio\", \"voice\", "
                "\"document\", \"animation\", \"location\", \"contact\", \"poll\", \"album\", \"copy\"."
            ),
            "mediaSource": "Fayl manbasi: {kind: \"url\"|\"file_id\", value: \"https://…\"}.",
            "buttons": (
                "Klaviatura: [{id, label, kind: \"callback\"|\"url\"|\"webapp\"|\"login\"|\"switch_inline\""
                "|\"copy\"|\"request_contact\"|\"request_location\", value, sameRow}]. "
                "Faqat \"callback\" tugmasi (yoki reply klaviaturadagi istalgan tugma) o'z portini beradi."
            ),
            "buttonMode": "\"inline\" (standart) yoki \"reply\".",
            "back": "«Orqaga» qatori matni. Yozilsa blok `back` portini ham chiqaradi.",
        },
    ),
    "question": BlockType(
        type="question",
        label="Savol berish",
        kind_label="Savol",
        ports=("out",),
        back_port=True,
        body_label="Savol matni",
        body_required=True,
        body_missing_hint="mijoz nima so'ralayotganini bilmaydi",
        fields={
            "text": "Mijozga beriladigan savol. Blok javob kelguncha kutadi.",
            "saveAnswerAs": (
                "Javob qaysi o'zgaruvchiga yoziladi, masalan \"mijoz_ismi\". "
                "Bo'sh qoldirilsa javob faqat `{{message.text}}` da qoladi."
            ),
            "answerType": (
                "Qanday javob kutilyapti: \"text\" (standart), \"phone\", \"email\", "
                "\"number\", \"date\". Matndan boshqasi tekshiriladi va bir ko'rinishga keltiriladi."
            ),
            "errorText": "Javob tushunilmaganda aytiladigan matn. Bo'sh bo'lsa tizim o'zi namuna bilan tushuntiradi.",
            "retryLimit": "Necha marta qayta so'raydi. Standart 3; undan keyin suhbat operatorga o'tadi.",
            "pattern": "Javob mos kelishi kerak bo'lgan regular expression. `answerType` tekshiruvi ustiga qo'shiladi.",
            "back": "«Orqaga» qatori matni. Yozilsa blok `back` portini ham chiqaradi.",
        },
    ),
    "followup": BlockType(
        type="followup",
        label="Kechiktirilgan eslatma",
        kind_label="Eslatma",
        ports=("out",),
        body_label="Eslatma matni",
        fields={
            "text": "Mijoz jim qolsa yuboriladigan eslatma.",
            "minutes": "Necha daqiqa jim qolsa yuborilsin. Oqim bu blokda TO'XTAMAYDI — darhol davom etadi.",
        },
    ),
    "language": BlockType(
        type="language",
        label="Til tanlash",
        kind_label="Til",
        ports=("out",),
        body_label="Savol",
        fields={
            "text": "Til so'raladigan matn.",
            "language": "{options: [{id, code: \"uz\"|\"ru\"|\"en\", label}]}. Tanlov `mijoz_tili` ga yoziladi.",
        },
    ),
    "condition": BlockType(
        type="condition",
        label="Shart",
        kind_label="Shart",
        ports=("yes", "no"),
        body_label="Mantiqiy ifoda",
        body_required=True,
        # `evaluate_condition` reads no rules as true, deliberately — an
        # unconfigured branch must not swallow every conversation — so an empty
        # Shart is not broken, it is a fork that only ever goes one way.
        body_missing_hint="shartsiz blok har doim «Ha» tomonga o'tadi",
        fields={
            "condition": (
                "{combinator: \"AND\"|\"OR\", rules: [{id, negate, "
                "field: \"message_text\"|\"command\"|\"user_username\"|\"user_first_name\"|\"chat_type\""
                "|\"chat_title\"|\"media_type\"|\"business_connection_id\"|\"variable\"|\"datetime\", "
                "variableName, operator: \"equals\"|\"not_equals\"|\"contains\"|\"not_contains\""
                "|\"starts_with\"|\"ends_with\"|\"is_empty\"|\"is_not_empty\"|\"after\"|\"before\", value}]}"
            ),
            "text": "Shartning kartadagi qisqa ta'rifi.",
        },
    ),
    "delay": BlockType(
        type="delay",
        label="Kutish",
        kind_label="Kutish",
        ports=("out",),
        body_label="Matn",
        fields={"minutes": "Necha daqiqa kutilsin. Oqim shu blokda haqiqatan to'xtaydi."},
    ),
    "tag": BlockType(
        type="tag",
        label="Ma'lumotni saqlash",
        kind_label="Ma'lumotni saqlash",
        ports=("out",),
        body_label="Matn",
        fields={
            "tagAction": "\"add\" | \"remove\" | \"set_variable\".",
            "tagName": "Teg nomi yoki o'zgaruvchi nomi.",
            "tagValue": "Faqat \"set_variable\" uchun — saqlanadigan qiymat, `{{…}}` bilan.",
        },
    ),
    "tableread": BlockType(
        type="tableread",
        label="Ma'lumot o'qish",
        kind_label="Ma'lumot o'qish",
        # Two exits, because a lookup that found nothing is a path an author
        # draws rather than an error the runtime swallows.
        ports=("yes", "no"),
        body_label="Izoh",
        fields={
            "tableRead": (
                "{\"handle\": ma'lumot nomi, \"column\": ustun, \"value\": qidiruv qiymati, "
                "\"into\": o'zgaruvchi prefiksi} — topilgan qator `{{prefiks.ustun}}` bo'lib o'qiladi."
            ),
        },
    ),
    "tablerow": BlockType(
        type="tablerow",
        label="Ma'lumot yozish",
        kind_label="Ma'lumot yozish",
        ports=("out",),
        body_label="Izoh",
        fields={
            "tableWrite": (
                "{\"handle\": ma'lumot nomi, \"values\": {ustun kaliti: matn}} — "
                "qiymatlar oddiy blok matni, ya'ni `{{…}}` ishlaydi."
            ),
        },
    ),
    "ai": BlockType(
        type="ai",
        label="AI javob",
        kind_label="AI",
        ports=("out",),
        body_label="AI ko'rsatmasi (prompt)",
        body_required=True,
        fields={
            "text": "Modelga beriladigan ko'rsatma (prompt).",
            "ai": (
                "{model, temperature, maxTokens, knowledgeSource: \"none\"|\"flow_context\""
                "|\"knowledge_base\"|\"website\", knowledgeRef, "
                "fallbackAction: \"message\"|\"handoff\"|\"flow\", fallbackText}"
            ),
        },
    ),
    "http": BlockType(
        type="http",
        label="HTTP so'rov",
        kind_label="HTTP",
        ports=("out",),
        body_label="So'rov",
        body_required=True,
        body_missing_hint="manzilsiz blok hech qayerga murojaat qilmaydi",
        fields={
            "text": (
                "So'rov manzili — `https://` bilan boshlanishi shart. Javob `{{http}}` ostida saqlanadi. "
                "Ichki tarmoq manzillari rad etiladi."
            ),
        },
    ),
    "flowlink": BlockType(
        type="flowlink",
        label="Oqimlar",
        kind_label="Oqimga o'tish",
        ports=("out",),
        body_label="Matn",
        fields={
            "target": "O'tiladigan oqim id'si.",
            "targetNodeId": "O'sha oqimning qaysi blokidan boshlansin. Yozilmasa oqim boshidan ishlaydi.",
        },
    ),
    "end": BlockType(
        type="end",
        label="Suhbatni tugatish",
        kind_label="Tugatish",
        ports=(),
        fields={},
    ),
}

#: Block types an update can open a flow at — the ones the canvas draws with no
#: input dot. `models.ENTRY_NODE_TYPES` and `runner.PASSTHROUGH_TYPES` are both
#: this set: it used to be written out three times (twice here, once in the
#: editor) and the skill file's "what it must stay out of" section is about what
#: happens when the copies disagree. One of them is now derived.
ENTRY_TYPES: frozenset[str] = frozenset(name for name, block in NODE_TYPES.items() if block.entry)

#: The entry blocks a flow *owns* — at most one of these survives per graph.
#: The group and channel event blocks are deliberately not here: they are
#: ordinary palette blocks, and a groups flow answering both a join and a leave
#: in one graph is a flow with two entry blocks on purpose.
OWNED_ENTRY_TYPES: frozenset[str] = frozenset(name for name, block in NODE_TYPES.items() if block.owns_entry)


def is_known(node_type: Any) -> bool:
    return isinstance(node_type, str) and node_type in NODE_TYPES


def definition(node_type: Any) -> BlockType | None:
    return NODE_TYPES.get(node_type) if isinstance(node_type, str) else None


def button_port_id(button_id: str) -> str:
    return f"{BUTTON_PORT_PREFIX}{button_id}"


def button_id_from_port(port: str) -> str | None:
    """The button an edge's port names, or None for a block's own exit."""
    if not isinstance(port, str) or not port.startswith(BUTTON_PORT_PREFIX):
        return None
    return port[len(BUTTON_PORT_PREFIX) :]


def published_ports(node: dict) -> set[str]:
    """Every exit this particular block publishes — what an edge may leave by.

    Three sources, and only the first is a property of the type: the fixed ports
    above, one `btn:<id>` per *routable* button, and `back` where the block
    carries a back row. The last two are read off the node because they are read
    off the node at run time too — `walk` asks `flow.next_node_id(id, port)` with
    exactly the port `dispatch._reply_port` produced, and that function derives
    the button ports from the block's own keyboard.

    Which buttons are routable is asked of `engine.runner`, not reimplemented:
    an inline `url` button never reports back to the bot, so no edge can leave
    it, and that rule already lives in one place. The import is local because the
    dependency runs the other way at module level — `runner` imports
    `flows.models`, which imports this file.

    **A keyboard the block cannot send publishes nothing.** `sendMediaGroup`
    accepts no `reply_markup` at all, so an album goes out bare: no row on it is
    ever on a customer's screen and no tap on one can ever arrive. The button
    ports have been read that way since `runner.node_buttons` existed —
    `routable_buttons` reads the content kind before it reads the keyboard — and
    the back row is the one row nobody had told. It published a `back` exit
    regardless, so the editor drew a dot for it, `graph_validation` accepted the
    edge leaving it, and the run then waited on a port no update can produce.
    Asking `build_keyboard`'s own rule here is what makes the two agree.

    Note what this does *not* do: an edge already stored on that port is not
    wrong to exist, it is only never walked. `graph_validation` reports it as a
    warning for exactly that reason, so a graph saved while the exit existed
    still saves.
    """
    from apps.engine.runner import routable_buttons  # local: see the docstring
    from apps.engine.sender import BUTTONLESS_CONTENT, content_kind  # local: same cycle

    block = definition(node.get("type"))
    if block is None:
        return set()

    ports = set(block.ports)
    if block.button_ports:
        ports.update(button_port_id(str(button.get("id", ""))) for button in routable_buttons(node))
    if block.back_port and node.get("back") is not None and content_kind(node) not in BUTTONLESS_CONTENT:
        ports.add(BACK_PORT)
    return ports


#: Bumped when the graph's *shape* changes in a way a generator has to know
#: about — a new port scheme, a renamed envelope key. Adding a block type does
#: not bump it: `nodeTypes` already carries that, and a version that moves for
#: every block is a version nobody can branch on.
#:
#: Nor does a new *optional* key in the export envelope, which is the question
#: `script` raised and the reason this note exists. The number is what a reader
#: branches on, and there is nothing here to branch on in either direction: a
#: reader written for 1 ignores a key it has never heard of, this importer takes
#: a file that has none, and a generator that writes no `script` still writes a
#: file that is entirely valid. Bumping would declare every file already in a
#: downloads folder to be of an older shape while nothing about them had become
#: wrong — the same argument the paragraph above makes about block types, and
#: the criterion it names is a key *renamed*, not a key added.
SCHEMA_VERSION = 1

#: The envelope, in the language of the people who will read it.
HOW_TO = (
    "Grafik — {\"nodes\": [...], \"edges\": [...]}. "
    "Har bir blok: {\"id\": \"n1\", \"type\": \"message\", \"title\": \"Xabar\", \"text\": \"...\", "
    "\"x\": 300, \"y\": 40}. `id` takrorlanmasin. "
    "Har bir bog'lanish: {\"id\": \"e1\", \"from\": \"n1\", \"port\": \"out\", \"to\": \"n2\"} — "
    "`port` MAJBURIY va faqat shu blok chiqaradigan portlardan biri bo'lishi mumkin "
    "(quyidagi `ports`, tugmalar uchun `btn:<tugma id>`, «Orqaga» qatori uchun `back`). "
    "Oqimda bittagina boshlanish bloki bo'ladi: bot ichidagi oqim uchun `start` yoki `trigger`. "
    "Boshlanish blokiga hech qanday bog'lanish kirmaydi. "
    "Matnlarda `{{o'zgaruvchi}}` ishlaydi; noma'lum nom qavslari bilan qolib ketadi."
)


def schema_payload() -> dict:
    """What `GET /api/flows/schema/` answers with.

    Written to be pasted into another AI with no other context, which is the
    whole point of the endpoint: it has to say what a node and an edge look like
    before it lists what may go in one. Hence `howTo` — a list of node types
    with no statement of the envelope around them produces graphs whose every
    block is right and whose edges go nowhere.
    """
    return {
        "version": SCHEMA_VERSION,
        "howTo": HOW_TO,
        "nodeTypes": [
            {
                "type": block.type,
                "label": block.label,
                "kindLabel": block.kind_label,
                "ports": list(block.ports),
                "entry": block.entry,
                "buttonPorts": block.button_ports,
                "backPort": block.back_port,
                "bodyLabel": block.body_label,
                "bodyRequired": block.body_required,
                "fields": dict(block.fields),
            }
            for block in NODE_TYPES.values()
        ],
    }
