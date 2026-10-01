"""Reading a graph before the runtime has to.

The editor cannot draw a block type that does not exist or an edge leaving a
port nobody published, so for as long as the editor was the only writer this
file had nothing to do. It is not the only writer any more: a graph can be
generated somewhere else — by another model, by a script, by hand — and uploaded
whole. Everything the editor guaranteed by construction now has to be checked.

What each failure actually costs, which is why the two severities are split
where they are:

- an **unknown type** is stepped over by `runner.execute` and the customer is
  told nothing (it used to be *sent to them* as a message carrying the block's
  own body text — see the `oqim-blok` skill);
- an **unpublished port** is an edge `walk` never follows, so the conversation
  stops dead at that block with no error anywhere;
- an **edge with no `port` key** is the same thing and easier to write by
  accident: `Flow.edge` compares `edge["port"] == port` literally, so an edge
  that omits it matches nothing, ever.

Those refuse the save. A **warning** is something the author may well have meant
— a branch they have not wired yet, a flow that is still a draft — and refusing
those would make the endpoint unusable for the half-built graphs that are most of
what anybody saves.

Every message names the block and says what to do about it. "JSON is invalid"
tells the person holding the file nothing they can act on; «"s1" bloki noma'lum
turdagi: `kod`» tells them which block and which word to change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from apps.common.i18n import DEFAULT_LANGUAGE, resolve_text

from . import vocabulary
from .vocabulary import BACK_PORT, NODE_TYPES, OWNED_ENTRY_TYPES


SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"


@dataclass(frozen=True)
class Finding:
    """One thing wrong with the graph, addressed to whoever wrote it.

    `node_id` / `edge_id` are what let the interface put the finding on the
    thing it is about instead of in a list beside the canvas; either may be
    empty for a finding about the graph as a whole ("no entry block").
    """

    severity: str
    code: str
    message: str
    node_id: str = ""
    edge_id: str = ""

    @property
    def is_error(self) -> bool:
        return self.severity == SEVERITY_ERROR

    def as_payload(self) -> dict:
        """camelCase, and the empty keys left out — the shape `features/flows`
        describes and the same one the error envelope already uses."""
        payload: dict[str, Any] = {"severity": self.severity, "code": self.code, "message": self.message}
        if self.node_id:
            payload["nodeId"] = self.node_id
        if self.edge_id:
            payload["edgeId"] = self.edge_id
        return payload


def _label(node: dict) -> str:
    """How a finding names the block: its id, since that is the one thing the
    author can search their own file for. The title is added when there is one,
    because on a canvas of thirty blocks an id alone is not recognisable."""
    node_id = str(node.get("id") or "").strip()
    title = str(node.get("title") or "").strip()
    if node_id and title:
        return f"«{node_id}» ({title})"
    return f"«{node_id or title or '?'}»"


def _body(node: dict) -> str:
    """The block's body as it would actually be sent — a bare string or the
    right half of a translation map, resolved the way `sender.render_text`
    resolves it. Reading `node["text"]` directly reports a fully translated
    block as empty."""
    return resolve_text(node.get("text"), DEFAULT_LANGUAGE).strip()


def _content_kind(node: dict) -> str:
    """What the block sends. Asked of the sender rather than read off
    `contentKind`, because the block's *type* overrules that field — a menu
    converted out of an album Xabar still says "album" there."""
    from apps.engine.sender import content_kind  # local: engine imports flows.models

    return content_kind(node)


def _reachable_ids(nodes: list[dict], edges: list[dict]) -> set[str]:
    """Every block an update can arrive at, walked forward from the entry blocks.

    Same walk as `lib/validate-graph.ts::reachableIds`, and the same reason for
    starting only at entry blocks: an edge into a `trigger` is not a way to
    reach it — the canvas gives entry blocks no input dot at all.
    """
    seen: set[str] = set()
    queue = [str(node.get("id")) for node in nodes if node.get("type") in vocabulary.ENTRY_TYPES]
    while queue:
        node_id = queue.pop()
        if node_id in seen:
            continue
        seen.add(node_id)
        queue.extend(str(edge.get("to")) for edge in edges if str(edge.get("from")) == node_id)
    return seen


def validate_graph(graph: Any) -> list[Finding]:
    """Everything wrong with this graph, errors and warnings together.

    Never raises on a malformed payload: a caller uploading a file has to be
    told what is wrong with it, and an exception two frames down is not that.
    A `graph` that is not an object with two lists comes back as one error
    saying so.
    """
    if not isinstance(graph, dict):
        return [Finding(SEVERITY_ERROR, "invalid_graph", "Grafik obyekt bo'lishi kerak: {\"nodes\": [], \"edges\": []}")]

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return [
            Finding(
                SEVERITY_ERROR,
                "invalid_graph",
                "Grafikda «nodes» va «edges» ro'yxatlari bo'lishi kerak",
            )
        ]

    findings: list[Finding] = []
    findings += _check_nodes(nodes)
    # The edge rules all read the node table, so they are only worth running
    # against nodes that parsed: an edge "pointing at a missing block" when
    # every block is missing is thirty findings about one problem.
    findings += _check_edges(nodes, edges)
    findings += _check_graph_shape(nodes, edges)
    return findings


def _check_nodes(nodes: list) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[str] = set()

    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            findings.append(
                Finding(SEVERITY_ERROR, "invalid_node", f"{index + 1}-blok obyekt emas — har bir blok JSON obyekt bo'lishi kerak")
            )
            continue

        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip():
            findings.append(
                Finding(
                    SEVERITY_ERROR,
                    "missing_node_id",
                    f"{index + 1}-blokda «id» yo'q — har bir blokning takrorlanmas id'si bo'lishi kerak",
                )
            )
            continue
        node_id = node_id.strip()

        if node_id in seen:
            findings.append(
                Finding(
                    SEVERITY_ERROR,
                    "duplicate_node_id",
                    f"«{node_id}» id'si ikki marta ishlatilgan — id takrorlanmasligi kerak",
                    node_id=node_id,
                )
            )
            continue
        seen.add(node_id)

        block = vocabulary.definition(node.get("type"))
        if block is None:
            findings.append(
                Finding(
                    SEVERITY_ERROR,
                    "unknown_type",
                    f"{_label(node)} bloki noma'lum turdagi: `{node.get('type')}`. "
                    f"Ruxsat etilganlari: {', '.join(NODE_TYPES)}",
                    node_id=node_id,
                )
            )
            continue

        findings += _check_node_body(node, node_id, block)

    return findings


def _check_node_body(node: dict, node_id: str, block: vocabulary.BlockType) -> list[Finding]:
    """The empty-body warning.

    Only where an empty body means nothing runs. A Xabar sending a photo is
    exempt: its `text` is a caption then, and Telegram takes a photo with no
    caption perfectly happily — which is why this asks the sender what the block
    sends rather than trusting the type alone.
    """
    if not block.body_required or _body(node):
        return []
    if block.button_ports and _content_kind(node) != "text":
        return []
    return [
        Finding(
            SEVERITY_WARNING,
            "empty_body",
            f"{_label(node)} blokida «{block.body_label or 'Matn'}» to'ldirilmagan — {block.body_missing_hint}",
            node_id=node_id,
        )
    ]



def _check_edges(nodes: list, edges: list) -> list[Finding]:
    by_id = {
        str(node["id"]).strip(): node
        for node in nodes
        if isinstance(node, dict) and isinstance(node.get("id"), str) and node["id"].strip()
    }
    findings: list[Finding] = []

    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            findings.append(
                Finding(SEVERITY_ERROR, "invalid_edge", f"{index + 1}-bog'lanish obyekt emas")
            )
            continue

        edge_id = str(edge.get("id") or "").strip()
        source = str(edge.get("from") or "")
        target = str(edge.get("to") or "")
        name = f"«{edge_id}»" if edge_id else f"{index + 1}-bog'lanish"

        missing = ", ".join(f"`{end}`" for end in (source, target) if end not in by_id)
        if missing:
            findings.append(
                Finding(
                    SEVERITY_ERROR,
                    "edge_to_missing_node",
                    f"{name} mavjud bo'lmagan blokka ishora qilyapti: {missing}",
                    edge_id=edge_id,
                )
            )
            continue

        node = by_id[source]
        block = vocabulary.definition(node.get("type"))
        if block is None:
            # Already reported as an unknown type; naming its ports here would
            # be a second finding about the same one word.
            continue

        port = edge.get("port")
        if not isinstance(port, str) or not port:
            # Not a cosmetic omission: `Flow.edge` matches on the literal value,
            # so an edge with no port is one the runtime can never follow. It is
            # also the single most likely thing for a generator to leave out.
            findings.append(
                Finding(
                    SEVERITY_ERROR,
                    "missing_port",
                    f"{name} bog'lanishida «port» ko'rsatilmagan — {_label(node)} blokining chiqishlari: "
                    f"{_ports_hint(node, block)}",
                    edge_id=edge_id,
                    node_id=source,
                )
            )
            continue

        findings += _check_edge_port(edge_id, name, node, source, block, port)

    findings += _check_incoming_edges(by_id, edges)
    return findings


def _check_edge_port(
    edge_id: str, name: str, node: dict, source: str, block: vocabulary.BlockType, port: str
) -> list[Finding]:
    if port in vocabulary.published_ports(node):
        return []

    # Three near-misses get a warning rather than a refusal, because in each the
    # author's intent is legible and the block does exist: they wired a button
    # Telegram never reports back on, a back row they have since removed, or a
    # back row on a block that goes out as an album and carries no keyboard at
    # all. Refusing those would refuse graphs the editor itself can produce —
    # and the last one would refuse graphs it has already saved, which is a
    # flow its own author can no longer edit.
    button_id = vocabulary.button_id_from_port(port)
    if button_id is not None and any(str(b.get("id")) == button_id for b in (node.get("buttons") or [])):
        return [
            Finding(
                SEVERITY_WARNING,
                "unroutable_button",
                f"{_label(node)} blokidagi `{port}` tugmasi Telegram'ga javob qaytarmaydi "
                "(faqat «callback» tugmasi yoki reply klaviatura tarmoq ochadi) — bu bog'lanish hech qachon yurmaydi",
                edge_id=edge_id,
                node_id=source,
            )
        ]

    if port == BACK_PORT and block.back_port:
        # Two different mistakes wearing one port, and they need different
        # sentences. The row was removed and the edge outlived it — or the row
        # is right there on the card and the block sends something Telegram
        # takes no keyboard with, which is a fact about the *content kind* and
        # is fixed by changing that rather than by touching the row.
        if node.get("back") is None:
            return [
                Finding(
                    SEVERITY_WARNING,
                    "missing_back_row",
                    f"{_label(node)} blokida «Orqaga» qatori yo'q, lekin `back` chiqishidan bog'lanish ketyapti — "
                    "blokka `back` maydonini qo'shing yoki bu bog'lanishni o'chiring",
                    edge_id=edge_id,
                    node_id=source,
                )
            ]
        return [
            Finding(
                SEVERITY_WARNING,
                "unsent_back_row",
                f"{_label(node)} blokining «Orqaga» qatori albom bilan yuborilmaydi — Telegram sendMediaGroup "
                "ostiga klaviatura qo'ymaydi, shuning uchun bu bog'lanish hech qachon yurmaydi. "
                "Qatorni o'chiring yoki blok nima yuborishini o'zgartiring",
                edge_id=edge_id,
                node_id=source,
            )
        ]

    return [
        Finding(
            SEVERITY_ERROR,
            "unknown_port",
            f"{name} {_label(node)} blokida yo'q chiqishdan ketyapti: `{port}`. "
            f"Bu blokning chiqishlari: {_ports_hint(node, block)}",
            edge_id=edge_id,
            node_id=source,
        )
    ]


def _ports_hint(node: dict, block: vocabulary.BlockType) -> str:
    """The exits this block really has, spelled out — the half of the message
    that makes it actionable. Says what a button port would look like rather
    than listing the block's buttons, since a generator writing `success` for
    `ok` has not read the button list either.

    The button clause is dropped where the block goes out as an album, because
    then it is not true: `sendMediaGroup` carries no keyboard, so no button on
    that block publishes anything and telling the reader to write `btn:<id>`
    would send them round the same refusal a second time.
    """
    from apps.engine.sender import BUTTONLESS_CONTENT  # local: engine imports flows.models

    ports = sorted(vocabulary.published_ports(node))
    listed = ", ".join(f"`{port}`" for port in ports) if ports else "yo'q (bu blok suhbatni tugatadi)"
    if block.button_ports and _content_kind(node) not in BUTTONLESS_CONTENT:
        listed += ", har bir «callback» tugmasi uchun `btn:<tugma id>`"
    return listed


def _check_incoming_edges(by_id: dict[str, dict], edges: list) -> list[Finding]:
    """An edge landing on an entry block.

    The canvas draws no input dot on one and refuses the drop, so this can only
    arrive from outside the editor — and it is a real misunderstanding rather
    than a typo: a generator that thinks a Handler is an ordinary step will wire
    the whole flow through it. The edge is simply never walked; the run finishes
    at the block before it.
    """
    findings: list[Finding] = []
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            continue
        target = str(edge.get("to") or "")
        node = by_id.get(target)
        if node is None:
            continue
        block = vocabulary.definition(node.get("type"))
        if block is None or not block.entry:
            continue
        edge_id = str(edge.get("id") or "").strip()
        name = f"«{edge_id}»" if edge_id else f"{index + 1}-bog'lanish"
        findings.append(
            Finding(
                SEVERITY_ERROR,
                "edge_into_entry",
                f"{name} {_label(node)} boshlanish blokiga kiryapti — boshlanish bloklariga bog'lanish kirmaydi, "
                "ular faqat oqimni ochadi",
                edge_id=edge_id,
                node_id=target,
            )
        )
    return findings


def _check_graph_shape(nodes: list, edges: list) -> list[Finding]:
    """The two rules about the graph rather than about any one block in it."""
    findings: list[Finding] = []
    blocks = [node for node in nodes if isinstance(node, dict) and vocabulary.definition(node.get("type"))]

    owned = [node for node in blocks if node.get("type") in OWNED_ENTRY_TYPES]
    if len(owned) > 1:
        # Not a preference: `node-registry.ts::applyEntryRule` keeps the first
        # and *deletes* the rest the next time the graph is opened, taking the
        # edges with them. Accepting the import would mean handing back a flow
        # that quietly loses blocks on its first edit. The group and channel
        # event blocks are exempt — they are ordinary palette blocks, and a
        # flow answering both a join and a leave has two entries on purpose.
        listed = ", ".join(_label(node) for node in owned)
        findings.append(
            Finding(
                SEVERITY_ERROR,
                "multiple_entries",
                f"Oqimda bittadan ortiq boshlanish bloki bor: {listed}. "
                "Bitta oqim bitta shartga javob beradi — qolganlarini alohida oqimga ajrating",
                node_id=str(owned[1].get("id") or ""),
            )
        )

    entries = [node for node in blocks if node.get("type") in vocabulary.ENTRY_TYPES]
    if not entries:
        # A warning and not a refusal: a graph is uploaded to be finished, and
        # the editor gives a `dms`/`business`/`webapp` flow its entry block back
        # on load anyway. What it costs meanwhile is that nothing opens the
        # flow, which is worth saying out loud.
        findings.append(
            Finding(
                SEVERITY_WARNING,
                "no_entry",
                "Oqimda boshlanish bloki yo'q — uni hech narsa ishga tushirmaydi. "
                "`start` yoki `trigger` bloki qo'shing",
            )
        )

    findings += _check_unreachable(blocks, edges, has_entry=bool(entries))
    findings += _check_dangling_ports(blocks, edges)
    return findings


def _check_unreachable(blocks: list[dict], edges: list, *, has_entry: bool) -> list[Finding]:
    if not has_entry:
        # Every block would be reported unreachable, which is one problem said
        # thirty times — and it is already said once, above.
        return []
    reachable = _reachable_ids(blocks, edges)
    return [
        Finding(
            SEVERITY_WARNING,
            "unreachable",
            f"{_label(node)} blokiga hech qaysi yo'l olib bormaydi — u hech qachon ishlamaydi",
            node_id=str(node.get("id") or ""),
        )
        for node in blocks
        if str(node.get("id")) not in reachable
    ]


def _check_dangling_ports(blocks: list[dict], edges: list) -> list[Finding]:
    """A named exit wired to nothing.

    The block's own `out` is left alone: nothing after it means the flow ends
    there, which is how flows end. A *named* exit is a promise — a button that
    answers nothing, a «Bekor» that leads nowhere, a Kod block's `error` — and
    an unwired one is where a conversation stops with the customer waiting.
    Same rule as `lib/validate-graph.ts`, so the panel in the editor and the
    report on an import say the same thing about the same graph.
    """
    wired = {(str(edge.get("from")), edge.get("port")) for edge in edges if isinstance(edge, dict)}
    findings: list[Finding] = []
    for node in blocks:
        node_id = str(node.get("id") or "")
        for port in sorted(vocabulary.published_ports(node)):
            if port == "out" or (node_id, port) in wired:
                continue
            findings.append(
                Finding(
                    SEVERITY_WARNING,
                    "dangling_port",
                    f"{_label(node)} blokining `{port}` chiqishi hech qayerga ulanmagan — "
                    "shu yo'ldan kelgan mijoz javobsiz qoladi",
                    node_id=node_id,
                )
            )
    return findings


def errors_of(findings: list[Finding]) -> list[Finding]:
    return [finding for finding in findings if finding.is_error]


def summarise(graph: Any) -> dict:
    """The counts the report is headed with. Deliberately tolerant of a graph
    that did not validate — the caller is being shown *why* it did not, and a
    summary that refuses to count is one more thing they have to work out."""
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    edges = graph.get("edges") if isinstance(graph, dict) else None
    nodes = nodes if isinstance(nodes, list) else []
    edges = edges if isinstance(edges, list) else []

    types: dict[str, int] = {}
    for node in nodes:
        if isinstance(node, dict):
            key = node.get("type")
            types[str(key)] = types.get(str(key), 0) + 1
    return {"nodes": len(nodes), "edges": len(edges), "types": types}
