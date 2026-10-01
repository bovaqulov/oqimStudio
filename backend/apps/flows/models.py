"""Flows — the graphs the editor saves and the runtime walks.

`nodes` and `edges` are stored as JSON, not as tables. A block is a wide,
polymorphic thing (a poll block and an HTTP block share almost no fields) and
the editor always reads and writes the whole graph at once, so normalising it
would buy queries nobody makes and cost a migration every time a block gains an
option.

What the runtime *does* need to query — "which flow answers this update" —
cannot be answered by scanning JSON at message rate, so it is denormalised into
`FlowTrigger` rows whenever a graph is saved. That index is derived data: it is
rebuilt from the graph, never edited on its own.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from apps.bots.models import Bot
from apps.common.models import new_id
from apps.projects.models import Project
from apps.workspaces.models import Workspace

from .vocabulary import ENTRY_TYPES

MODULE_CHOICES = [
    ("business", "Business"),
    ("groups", "Guruh"),
    ("channels", "Kanal"),
    ("dms", "Bot ichida"),
    ("webapp", "Web App"),
]

#: Block types an update can open a flow at — the ones the canvas draws with no
#: input dot. Everything else is only reachable through an edge.
#:
#: Derived rather than written out, and this is the third place it used to be
#: written out: `runner.PASSTHROUGH_TYPES` was the second and
#: `node-registry.ts::ENTRY_NODE_TYPES` is the one that is still its own copy
#: (a contract test holds that pair together). An entry set that has drifted is
#: not a visible bug — `derive_triggers` mints a catch-all `FlowTrigger` from
#: whatever is in it, which answers *every* message the bot receives. Kept as a
#: module-level name because half the codebase imports it from here.
ENTRY_NODE_TYPES = ENTRY_TYPES

#: Mirrors `features/flow-builder/lib/trigger.ts`. Lower runs first.
PRIORITY_EXACT = 1
PRIORITY_PARTIAL = 2
PRIORITY_CATCH_ALL = 3


class Flow(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=new_id, editable=False)
    #: Tenant this flow belongs to — every read is filtered by it.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="flows")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="flows")
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="flows")
    module_key = models.CharField(max_length=16, choices=MODULE_CHOICES)

    name = models.CharField(max_length=120)
    description = models.CharField(max_length=280, blank=True)
    status = models.CharField(max_length=32, default="Qoralama")
    status_tone = models.CharField(max_length=16, default="neutral")

    #: Whether the runtime hands updates to this flow at all. Separate from
    #: `status`, which is only a label: a finished draft nobody switched on is
    #: a real and common state.
    enabled = models.BooleanField(default=False)
    #: The `dms` module's main flow: one per bot, the only flow a /start
    #: handler lives in. Never set on the other modules.
    is_main = models.BooleanField(default=False)

    #: How the flow came into being — template / wizard / blank, plus its label.
    #: Which editor the author last used — "simple" (a top-to-bottom list of
    #: steps) or "pro" (the canvas). A view setting and nothing more: one graph
    #: underneath, no conversion either way, so switching can never cost work.
    layout_mode = models.CharField(max_length=8, default="simple", choices=[("simple", "Oddiy"), ("pro", "Pro")])

    origin = models.JSONField(default=dict, blank=True)

    #: This flow's own JavaScript — the hooks that run around its blocks.
    #:
    #: Beside the bot's shared library (`Bot.script_library`) rather than inside
    #: it, because the two have different lifetimes and different owners: the
    #: library is `money()` and `phone()`, written once for every flow the bot
    #: runs, while this is what *this conversation* does. A key in `origin`
    #: would have been the cheap place to put it and the wrong one: it is
    #: edited by its own endpoint, checked for syntax before it is stored, and
    #: read on the hot path.
    #:
    #: **It travels with the flow**, which is the half a column has to be
    #: chosen for: `export` writes it into the file, both importers read it
    #: back and compile it before storing it (`services.refuse_broken_script`),
    #: and `duplicate` copies it — a copy that looked identical and behaved
    #: differently, with nothing on screen saying so, is the worst shape this
    #: could have taken.
    #:
    #: The market is the one route that does not carry it, and not by omission:
    #: `MarketTemplate` holds a graph and no script, because nothing publishes
    #: one — templates are seeded. The day a flow can be published as a
    #: template is the day that model needs this field, and `marketplace.install`
    #: needs the same compile check the two importers make.
    script = models.TextField(blank=True, default="")
    #: When the script was last written, and null until it first was. Not
    #: `updated_at`, which moves every time the canvas autosaves.
    script_updated_at = models.DateTimeField(null=True, blank=True)
    nodes = models.JSONField(default=list)
    edges = models.JSONField(default=list)

    #: How many times the flow has been entered — the one number its card shows.
    runs = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["bot", "module_key", "enabled"])]
        constraints = [
            # One entry point per bot, enforced where it is true rather than in
            # the code that happens to create flows.
            models.UniqueConstraint(
                fields=["bot"],
                condition=models.Q(is_main=True),
                name="uniq_main_flow_per_bot",
            )
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def is_empty(self) -> bool:
        return not self.nodes

    def node(self, node_id: str) -> dict | None:
        return next((node for node in self.nodes if node.get("id") == node_id), None)

    def edge(self, node_id: str, port: str = "out") -> dict | None:
        """The connection leaving that exit, or None where nothing is wired.

        The edge itself and not just its destination, because a connection now
        carries a setting of its own: what happens to the message already on
        screen when the block at the other end is delivered. See
        `apps.engine.transitions`.
        """
        for edge in self.edges:
            if edge.get("from") == node_id and edge.get("port") == port:
                return edge
        return None

    def next_node_id(self, node_id: str, port: str = "out") -> str | None:
        """Where an exit leads, or None when the author left it unconnected."""
        edge = self.edge(node_id, port)
        return edge.get("to") if edge else None

    def entry_nodes(self) -> list[dict]:
        return [node for node in self.nodes if node.get("type") in ENTRY_NODE_TYPES]


class FlowTrigger(models.Model):
    """One "this update opens that flow" rule, derived from an entry block.

    Rebuilt from the graph on every save (see `apps.flows.services.reindex_triggers`),
    which is why nothing here is authoritative: delete the lot and re-save the
    flow and you get the same rows back.
    """

    class Kind(models.TextChoices):
        # dms / business handlers
        START = "start", "/start"
        COMMAND = "command", "Buyruq"
        KEYWORD = "keyword", "Kalit so'z"
        ANY = "any", "Istalgan xabar"
        CALLBACK = "callback", "Tugma bosilishi"
        MEDIA = "media", "Media"
        REACTION = "reaction", "Reaksiya"
        PAYMENT = "payment", "To'lov"
        WEBAPP = "webapp", "Web App"
        BLOCKED = "blocked", "Bloklandi"
        UNBLOCKED = "unblocked", "Blokdan chiqdi"
        # group / channel event blocks
        GROUP_JOIN = "groupjoin", "Guruhga qo'shildi"
        GROUP_LEAVE = "groupleave", "Guruhdan chiqdi"
        JOIN_REQUEST = "joinrequest", "Qo'shilish so'rovi"
        CHANNEL_POST = "channelpost", "Kanal posti"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    flow = models.ForeignKey(Flow, on_delete=models.CASCADE, related_name="triggers")
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="triggers")
    module_key = models.CharField(max_length=16, choices=MODULE_CHOICES)
    #: The entry block this rule was read off.
    node_id = models.CharField(max_length=64)

    kind = models.CharField(max_length=16, choices=Kind.choices)
    #: Command name without its leading slash, when `kind` is "command".
    command = models.CharField(max_length=64, blank=True)
    #: One term (or regex) per line, when `kind` is "keyword".
    keywords = models.TextField(blank=True)
    keyword_match = models.CharField(max_length=16, default="contains")
    keyword_flags = models.CharField(max_length=8, blank=True)
    #: Content types this rule narrows to, when `kind` is "media".
    media_kinds = models.JSONField(default=list, blank=True)
    #: The working-hours window a business handler is restricted to, if any.
    schedule = models.JSONField(default=dict, blank=True)

    #: Lower runs first. The author's override when they set one, the derived level otherwise.
    priority = models.PositiveSmallIntegerField(default=PRIORITY_CATCH_ALL)
    #: Position of the entry block in the graph — the tie-break between equal priorities.
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["priority", "order"]
        indexes = [models.Index(fields=["bot", "module_key", "kind"])]

    def __str__(self) -> str:
        return f"{self.flow_id}:{self.node_id}:{self.kind}"


class FlowRun(models.Model):
    """One contact walking one flow.

    A run is durable because the graph can park: a question waits for an answer
    and a delay waits for the clock, both of which outlive the request that
    started them.
    """

    class Status(models.TextChoices):
        RUNNING = "running", "Ishlayapti"
        WAITING = "waiting", "Javob kutilmoqda"
        SLEEPING = "sleeping", "Kutish blokida"
        HANDOFF = "handoff", "Operatorda"
        DONE = "done", "Yakunlandi"
        FAILED = "failed", "Xato"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="runs")
    flow = models.ForeignKey(Flow, on_delete=models.CASCADE, related_name="runs_log")
    bot = models.ForeignKey(Bot, on_delete=models.CASCADE, related_name="runs")
    contact = models.ForeignKey(
        "contacts.Contact", on_delete=models.CASCADE, related_name="runs", null=True, blank=True
    )

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    #: The block the run is parked on — the one an answer or a wake-up continues from.
    current_node_id = models.CharField(max_length=64, blank=True)
    #: Everything gathered so far: question answers, HTTP results, the update that started it.
    #:
    #: A key beginning with two underscores is *scratch for one block* and is
    #: dropped on the way to the database — see `save` below. The single-underscore
    #: keys (`_screen_message_id` and its neighbours) are the opposite: they track
    #: the message on screen from one step to the next and have to survive.
    context = models.JSONField(default=dict)
    #: When a sleeping run is due to continue.
    resume_at = models.DateTimeField(null=True, blank=True)
    error = models.CharField(max_length=280, blank=True)
    #: True for a run started from the editor's test chat — kept out of the numbers.
    is_test = models.BooleanField(default=False)

    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["contact", "status"]),
            models.Index(fields=["status", "resume_at"]),
        ]

    def save(self, *args, **kwargs):
        """Stores the run, minus whatever was only ever meant for one block.

        `engine.expressions` caches a block's resolved `{{ funksiya(...) }}`
        values on the context, because that dict is what every renderer after it
        is handed. It is answered again for the next block and means nothing
        once this one is delivered — so a run parked for two days should not be
        carrying it, and `{{__expressions}}` should not be a placeholder anybody
        can resolve.

        Enforced here rather than at the five places that write the context,
        because a sixth one is the kind of thing that gets added without anyone
        remembering there was a rule.
        """
        scratch = (
            {key: value for key, value in self.context.items() if key.startswith("__")}
            if isinstance(self.context, dict)
            else {}
        )
        # Taken out for the write and put straight back. Not simply deleted:
        # `save` is called *during* a block — a step is recorded, the screen id
        # is stored — and the renderers that run after those still need the
        # values. Emptying the live dict made every expression on the block go
        # blank halfway through delivering it, which is how this comment came
        # to be here.
        for key in scratch:
            del self.context[key]
        try:
            super().save(*args, **kwargs)
        finally:
            self.context.update(scratch)

    def __str__(self) -> str:
        return f"{self.flow_id} · {self.status}"

    @property
    def is_parked(self) -> bool:
        return self.status in {self.Status.WAITING, self.Status.SLEEPING}


class FlowRunStep(models.Model):
    """One block, executed. The trace the test chat renders and analytics counts."""

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    run = models.ForeignKey(FlowRun, on_delete=models.CASCADE, related_name="steps")
    node_id = models.CharField(max_length=64)
    node_type = models.CharField(max_length=32)
    #: "bot" for something sent, "user" for something received, "system" for the rest.
    actor = models.CharField(max_length=16, default="system")
    text = models.TextField(blank=True)
    #: Anything structured the step produced: the Bot API payload, an HTTP body, an error.
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.node_type}:{self.node_id}"
