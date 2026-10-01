"""Gives every existing plan an `aiBlocks` limit.

The price list already said the entry plan is the one "AI bloklarisiz"; until
this ran that sentence was marketing copy the API had no way to honour, and a
missing key reads as uncapped. Plans added later declare the key themselves.
"""

from __future__ import annotations

from django.db import migrations

#: Only the entry plan is capped. Anything else keeps AI blocks uncapped —
#: refusing on a limit nobody has agreed to would be worse than not enforcing.
NO_AI_PLANS = {"start"}


def add_ai_block_limit(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    for plan in Plan.objects.all():
        limits = dict(plan.limits or {})
        if "aiBlocks" in limits:
            continue
        limits["aiBlocks"] = 0 if plan.pk in NO_AI_PLANS else None
        plan.limits = limits
        plan.save(update_fields=["limits"])


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]

    operations = [migrations.RunPython(add_ai_block_limit, migrations.RunPython.noop)]
