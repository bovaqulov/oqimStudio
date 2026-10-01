"""Which models an agent may run on, and what each one will and will not accept.

Two separate reasons this is a table rather than three `if model ==` branches
scattered through `provider.py`.

The first is the product one: **which model answers is configuration, not code.**
A routing agent that runs on every message and a support agent that runs on the
hard ones are the same code with a different row picked, and adding a fourth
model must not mean touching the request builder.

The second is that the request *shape* differs per model and the differences
are not cosmetic — each one is a 400 at run time, in front of a customer, on
the day somebody switches an agent from Haiku to Sonnet in a dropdown:

  * `temperature` is **removed** on Sonnet 5 and Opus 5 — sending it is a 400,
    not a value silently ignored. That is why an agent has no temperature knob
    at all where the older `ai` block has one: a slider that works on one row
    of this table and 400s on the other two is worse than no slider.
  * `output_config.effort` exists on Sonnet 5 and Opus 5 and **errors** on
    Haiku 4.5.
  * `thinking` is adaptive on Sonnet 5 and Opus 5 (`budget_tokens` is a 400
    there); on Haiku 4.5 adaptive does not exist and a budget is how you ask.
    Opus 5 thinks by default whether or not anybody asked.

So the row carries what the model accepts, `provider.build_request` reads the
row, and nothing else in this app knows a model id at all.

Prices are per million tokens and exist so that one number can be trusted —
`AgentRun.cost_usd`, which is what turns "the agent is expensive" from a
feeling into a query that answers itself. They are the published first-party
rates; a deployment billed through a cloud partner pays something else, and the
number is then an estimate rather than an invoice.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelDefinition:
    """One model an agent may be pointed at."""

    id: str
    label: str
    #: One line on what this model is *for* — the picker shows it, and "pick per
    #: job rather than one for everything" is only actionable if the job is named.
    hint: str
    input_price_per_mtok: float
    output_price_per_mtok: float
    context_tokens: int
    #: `output_config.effort` is accepted. False means sending it is an error,
    #: not a no-op.
    supports_effort: bool
    #: `thinking: {"type": "adaptive"}` is accepted.
    supports_adaptive_thinking: bool


#: Every model the product offers, in the order the picker lists them: the
#: everyday one first, then the cheap one, then the expensive one. An agent
#: answering customers is an ordinary conversation, and a list that opens with
#: the most capable model invites every workspace to pay Opus prices for
#: «ish vaqtingiz qanday?».
MODELS: tuple[ModelDefinition, ...] = (
    ModelDefinition(
        id="claude-sonnet-5",
        label="Claude Sonnet 5",
        hint="Kundalik mijoz suhbati uchun — tezlik va sifat muvozanati.",
        input_price_per_mtok=2.0,
        output_price_per_mtok=10.0,
        context_tokens=1_000_000,
        supports_effort=True,
        supports_adaptive_thinking=True,
    ),
    ModelDefinition(
        id="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        hint="Yo'naltirish va tasniflash uchun — minglab marta ishlaydigan qadamlar.",
        input_price_per_mtok=1.0,
        output_price_per_mtok=5.0,
        context_tokens=200_000,
        supports_effort=False,
        supports_adaptive_thinking=False,
    ),
    ModelDefinition(
        id="claude-opus-5",
        label="Claude Opus 5",
        hint="Mulohaza haqiqatan murakkab bo'lganda — sekinroq va qimmatroq.",
        input_price_per_mtok=5.0,
        output_price_per_mtok=25.0,
        context_tokens=1_000_000,
        supports_effort=True,
        supports_adaptive_thinking=True,
    ),
)

#: What a new agent lands on. The everyday model, not the strongest one.
DEFAULT_MODEL = MODELS[0].id

#: `output_config.effort` levels, cheapest first. Not every model takes them —
#: see `ModelDefinition.supports_effort`.
EFFORT_LEVELS = ("low", "medium", "high")
DEFAULT_EFFORT = "medium"


def get_model(model_id: str) -> ModelDefinition:
    """The row for `model_id`, falling back to the default.

    Falls back rather than raising on purpose: a stored agent can name a model
    that was taken off the list, and the honest failure there is "it answered
    on the everyday model" rather than "the bot stopped answering". Which model
    actually ran is written to `AgentRun.model`, so the fallback is visible in
    the trace instead of being silent.
    """
    for model in MODELS:
        if model.id == model_id:
            return model
    return MODELS[0]


def estimate_cost(model_id: str, *, input_tokens: int, output_tokens: int) -> float:
    """What one turn cost, in US dollars, at the published rates."""
    model = get_model(model_id)
    return (
        input_tokens * model.input_price_per_mtok + output_tokens * model.output_price_per_mtok
    ) / 1_000_000
