"""What an agent *is*, what it may do, and what it actually did.

Four tables and the reason each one exists:

  * `Agent` — who it is and what bounds it. The persona and the instructions
    live here rather than on the block, because a block is drawn once per exit
    and an agent is one thing a workspace maintains: an author who fixes a
    wording fixes it in one place, and every flow that calls the agent gets the
    fix. It is also the reason the system instruction can never be assembled
    from conversation text — there is no path from a Telegram message to this
    column (see `services.build_system_prompt`).
  * `AgentTool` — one thing the agent may do, declared by the author. The tools
    are the blocks the product already has, so a row here says *which* existing
    capability is exposed and with which arguments; it never carries code, a
    query or a free-form endpoint the model chooses.
  * `AgentRun` / `AgentMessage` — the trace. One row per block execution and
    one per message inside it, including every tool call with the arguments the
    model actually passed. This is the whole answer to "why did it say that",
    which is a question a deterministic flow never had to answer because the
    graph *was* the answer. An agent has no graph, so the trace is the graph.

The trace is deliberately a pair of tables rather than a JSON blob on the run:
"which agent spent the most last week" and "show me every time the model asked
for a phone number" are both ordinary queries against columns, and neither is
possible against a blob.
"""

from __future__ import annotations

from django.db import models

from apps.common.models import new_id
from apps.projects.models import Project
from apps.workspaces.models import Workspace

from .catalogue import DEFAULT_EFFORT, DEFAULT_MODEL

#: How many turns of the tool loop an agent gets before it is stopped, when the
#: author has not said otherwise.
#:
#: Four is two tool calls and an answer with room to spare. The number exists
#: because the failure it prevents is not "a slow reply" — it is a model that
#: calls a tool, reads the result, calls it again and never converges, which
#: without a ceiling is an unbounded bill produced by one customer sending one
#: message.
DEFAULT_MAX_TURNS = 4

#: The most tokens one agent may generate across a rolling day, per agent.
#:
#: A per-run cap alone does not bound anything: a loop that costs a cent and is
#: triggered by every incoming message costs whatever the message rate is. This
#: is the cap that turns a runaway agent into a stopped agent — see
#: `services.spent_today`.
DEFAULT_DAILY_TOKEN_BUDGET = 200_000


class Agent(models.Model):
    """One AI agent: who it is, what it may do, and what it may spend.

    Project-scoped, and **still not bot-scoped**. The old reason holds without
    a word changed: a project's «qabulxona» answers the same way on every bot
    the project owns, and an agent that had to be re-created per bot would
    drift between them — which for a persona is exactly the failure mode nobody
    notices until a customer quotes one bot at another. A project's bots share
    a subject, a customer and a tone, so one agent written for them is one
    agent, not three copies of one.

    What moved is the ceiling, not that floor. A workspace is an *account*: one
    company can run a clinic's booking bot and a shop's delivery bot out of the
    same one, and those two have nothing to say to each other. Everything an
    agent carries — the persona, the instruction, the tools and their URLs — is
    written about one of them. «Bemorga eng yaqin bo'sh qabul vaqtini ayt» is
    not merely useless in the shop, it is wrong there, and a picker that
    offered it would be offering the author a mistake to make. The project is
    the smallest unit that is still one business, which is why the line is
    drawn here rather than one level up.

    `workspace` stays beside `project` and is not redundant. It is the column
    every tenant filter reads — `WorkspaceScopedMixin`, `IsWorkspaceMember`,
    the trace, the budgets — and a project already belongs to a workspace, so
    the two cannot disagree: the narrow one says which folder, the wide one
    says whose. The API is what keeps them agreeing, by refusing a `projectId`
    from outside the caller's own workspace (`views.AgentViewSet`).

    The name is unique per *project* rather than per workspace for the same
    reason: two projects each wanting a «Qabulxona» is the ordinary case once
    an agent belongs to one of them, and the workspace-wide rule would have
    made the second one rename an agent to avoid a collision nobody can see.
    """

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="agents")
    #: The folder this agent belongs to, and the bounds of what may call it:
    #: `agent.ask` reaches an agent only from a flow of the same project (see
    #: `services.run_agent`).
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="agents")

    name = models.CharField(max_length=64)
    #: One line the author writes for themselves and for the card: "Klinika
    #: qabulxonasi". Never sent to the model — `instructions` is what the model
    #: reads, and a persona that lived in two places would drift between them.
    persona = models.CharField(max_length=280, blank=True)
    #: The system instruction, verbatim. **The only thing that becomes the
    #: system prompt**, alongside a fixed preamble this app owns. Nothing a
    #: customer types is ever concatenated into it — that is the first and
    #: cheapest prompt-injection layer, and it holds only as long as this
    #: column is the sole source.
    instructions = models.TextField(blank=True)

    model = models.CharField(max_length=48, default=DEFAULT_MODEL)
    #: `output_config.effort`, on the models that take one. Ignored where the
    #: model does not — see `catalogue.ModelDefinition.supports_effort`.
    effort = models.CharField(max_length=8, default=DEFAULT_EFFORT)
    #: Upper bound on one reply, in tokens. A Telegram message is short; this
    #: is low on purpose and the guard truncates below it anyway.
    max_output_tokens = models.PositiveIntegerField(default=800)

    max_turns = models.PositiveSmallIntegerField(default=DEFAULT_MAX_TURNS)
    #: 0 means uncapped, which is a decision an owner makes deliberately rather
    #: than a state an agent can drift into: a fresh agent lands on a budget.
    daily_token_budget = models.PositiveIntegerField(default=DEFAULT_DAILY_TOKEN_BUDGET)

    #: How many earlier turns of this conversation the model is shown. Zero is
    #: an agent that answers each message on its own, which is right for a
    #: classifier and wrong for a conversation.
    history_depth = models.PositiveSmallIntegerField(default=6)
    #: The longest reply that may reach a customer. Past it `guard` cuts at a
    #: sentence boundary rather than mid-word.
    reply_max_chars = models.PositiveIntegerField(default=1200)

    #: Where a failure goes. True routes everything that is not an answer to the
    #: block's «operatorga» exit; false routes it to «tushunmadi», where the
    #: author writes their own apology. The choice is theirs because it depends
    #: on something this code cannot know — whether there is anybody on the
    #: other end of the handover at two in the morning.
    escalate_on_failure = models.BooleanField(default=True)

    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="agent_name_unique_per_project"),
        ]

    def __str__(self) -> str:
        return self.name


class AgentTool(models.Model):
    """One thing an agent may do, and the exact arguments it may do it with.

    There is no second tool system here on purpose. Every kind maps onto a
    block the runtime already has and reuses that block's code path — the HTTP
    tool goes through `engine.safe_http`, which already refuses the metadata
    endpoint and the private ranges; the handoff tool ends on the same exit an
    «Operatorga» block is wired to. Reuse is not tidiness: a second HTTP client
    written for agents would be a second SSRF hole, and it would be the one
    nobody audited.

    `config` holds the author's half of the contract — the URL template, the
    variable name — and `params` inside it holds the *typed* argument list the
    model is allowed to fill in. The model never supplies a URL, a query or a
    field name; it supplies values for parameters somebody drew. See
    `tools.py`.
    """

    class Kind(models.TextChoices):
        #: Calls an endpoint the author wrote, with the model's validated
        #: arguments substituted in. `engine.safe_http` does the fetching.
        HTTP = "http", "Ma'lumot olish (HTTP)"
        #: Writes one named variable onto the contact — the same thing a
        #: «Ma'lumotni saqlash» block does.
        SAVE = "save", "Ma'lumotni saqlash"
        #: Asks for a person. Takes no side effect of its own: it ends the turn
        #: and the block leaves through «operatorga», where the author has drawn
        #: what a handover means for this flow.
        HANDOFF = "handoff", "Operatorga uzatish"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="tools")

    kind = models.CharField(max_length=16, choices=Kind.choices)
    #: The name the model sees. Snake case and no dots — it is an identifier in
    #: the tool schema, not a label.
    name = models.CharField(max_length=48)
    #: What the tool is for, written for the model. This is model-facing text an
    #: author controls, which makes it the one place their words reach the
    #: prompt — bounded in length, and it can only ever describe a tool that
    #: already exists.
    description = models.CharField(max_length=280, blank=True)
    config = models.JSONField(default=dict, blank=True)
    enabled = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["agent", "name"], name="agent_tool_name_unique_per_agent"),
        ]

    def __str__(self) -> str:
        return f"{self.agent_id}·{self.name}"


class AgentRun(models.Model):
    """One execution of one `agent.ask` block, and how it ended.

    One row per block execution rather than per conversation: the block is
    where the money is spent and where the exit is chosen, so that is the unit
    a bill and a bug are both asked about. The conversation is recovered by
    filtering on `contact`, which is also how `services` assembles the history
    the model is shown.
    """

    class Outcome(models.TextChoices):
        """The exit taken. The same three the block publishes, by their port ids."""

        ANSWERED = "answered", "Javob berdi"
        UNCLEAR = "unclear", "Tushunmadi"
        HANDOFF = "handoff", "Operatorga"

    class Reason(models.TextChoices):
        """*Why* that exit, which the outcome alone cannot say.

        «tushunmadi» is reached by a model that had nothing to add, by a missing
        API key and by a spent budget, and those are three different things to
        do something about.
        """

        OK = "ok", "Javob berildi"
        #: The model asked for a person.
        TOOL_HANDOFF = "tool_handoff", "Model operator so'radi"
        #: The model answered with nothing, or with something the guard refused.
        EMPTY = "empty", "Bo'sh javob"
        REFUSED = "refused", "Model javob berishdan bosh tortdi"
        BLOCKED = "blocked", "Javob tekshiruvdan o'tmadi"
        #: The turn ceiling was reached with no answer produced.
        TURNS = "turns", "Qadamlar tugadi"
        #: The agent's own daily token budget.
        BUDGET = "budget", "Kunlik byudjet tugadi"
        #: The workspace's plan does not cover this.
        PLAN = "plan", "Tarif chegarasi"
        #: No API key, no SDK, or the agent is switched off / missing.
        UNAVAILABLE = "unavailable", "Sozlanmagan"
        #: The graph names an agent from another project. Its own reason and
        #: not `unavailable`, because the two are fixed in different places:
        #: one is a key somebody has to install, the other is a block somebody
        #: has to re-point — and a trace that called both "sozlanmagan" would
        #: send the author to the wrong screen.
        PROJECT = "project", "Agent boshqa loyihaniki"
        #: The provider answered with an error, or did not answer.
        ERROR = "error", "Xato"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="agent_runs")
    #: Null once the agent it belonged to is deleted — a bill and a trace
    #: outlive the configuration that produced them, and a cascade here would
    #: quietly erase the evidence along with the agent somebody removed because
    #: of it.
    agent = models.ForeignKey(Agent, on_delete=models.SET_NULL, null=True, blank=True, related_name="runs")
    #: The conversation this turn belongs to. Nullable because an agent can be
    #: exercised from the panel with no flow behind it.
    flow_run = models.ForeignKey(
        "flows.FlowRun", on_delete=models.SET_NULL, null=True, blank=True, related_name="agent_runs"
    )
    contact = models.ForeignKey(
        "contacts.Contact", on_delete=models.SET_NULL, null=True, blank=True, related_name="agent_runs"
    )
    #: The block on the canvas. A flow can call the same agent from two places
    #: and they are two different questions.
    node_id = models.CharField(max_length=64, blank=True)

    outcome = models.CharField(max_length=16, choices=Outcome.choices)
    reason = models.CharField(max_length=24, choices=Reason.choices, default=Reason.OK)
    #: Which model actually ran — not which one the agent names. The two differ
    #: when a stored agent points at a model that has left the catalogue.
    model = models.CharField(max_length=48, blank=True)
    turns = models.PositiveSmallIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    #: Six decimal places because one Haiku turn is worth a fraction of a cent
    #: and a column that rounded it to zero would report every cheap agent as free.
    cost_usd = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    #: What went out, after the guard. Empty on every exit but «javob berdi».
    reply = models.TextField(blank=True)
    error = models.CharField(max_length=280, blank=True)
    is_test = models.BooleanField(default=False)

    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [
            # The two questions asked of this table: "what has this agent spent
            # today" (the budget check, on every message) and "show me this
            # conversation".
            models.Index(fields=["agent", "started_at"]),
            models.Index(fields=["contact", "started_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.agent_id}·{self.outcome}"

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class AgentMessage(models.Model):
    """One message inside a run — including every tool call, with its arguments.

    The tool rows are the point. A reply that looks wrong is usually a tool that
    was called with something surprising, and without the arguments written down
    the only way to find out is to reproduce a conversation that has already
    ended.
    """

    class Role(models.TextChoices):
        SYSTEM = "system", "Ko'rsatma"
        USER = "user", "Mijoz"
        ASSISTANT = "assistant", "Agent"
        #: The model asked for a tool. `payload` holds `{"tool", "input"}` —
        #: the arguments *as validated*, never the raw ones, so the trace shows
        #: what actually ran.
        TOOL_USE = "tool_use", "Vosita chaqirildi"
        TOOL_RESULT = "tool_result", "Vosita javobi"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    run = models.ForeignKey(AgentRun, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=16, choices=Role.choices)
    text = models.TextField(blank=True)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return f"{self.run_id}·{self.role}"
