"""Gives every existing plan a `scripts` limit — which plan a flow may carry code on.

Scripting opens on the first paid plan, and on the same boundary AI blocks
already sit on, because they are the same purchase: compute we run for a tenant
between two messages. One boundary is one sentence to explain, and a second one
drawn somewhere else would be a second thing a reader has to discover by being
refused.

A missing key reads as uncapped (`services.plan_limit`), so until this ran the
entry plan had unlimited scripts while its own limits screen had no row for
them at all. Plans added later declare the key themselves — `default_limits`.
"""

from __future__ import annotations

from django.db import migrations

#: Only the entry plan is capped, exactly as `0002` capped AI blocks. Anything
#: else keeps scripts uncapped: refusing on a limit nobody agreed to when they
#: paid would be worse than not enforcing one.
NO_SCRIPT_PLANS = {"start"}


def add_script_limit(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    for plan in Plan.objects.all():
        limits = dict(plan.limits or {})
        if "scripts" in limits:
            continue
        limits["scripts"] = 0 if plan.pk in NO_SCRIPT_PLANS else None
        plan.limits = limits
        plan.save(update_fields=["limits"])


class Migration(migrations.Migration):
    dependencies = [("billing", "0002_plan_ai_block_limit")]

    operations = [migrations.RunPython(add_script_limit, migrations.RunPython.noop)]
