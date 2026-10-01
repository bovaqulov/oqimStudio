"""Names the entry plan in the language the rest of the product is written in.

The row read «Free» and its price rendered «Bepul», so every screen that draws
a plan drew both — «Free · Bepul» on the billing header, on the settings card
and on the plan grid. One meaning, twice, in two languages, in a product whose
interface is Uzbek.

The *name* is the half that moves. «Bepul» is the price and is right where it
stands; it is also what the marketplace prints for a free template, so the two
would still have been side by side. And only the name was ever shown to a
customer — the key stays `start`, which is what `workspace.plan_key` and every
subscription row point at.
"""

from __future__ import annotations

from django.db import migrations

ENTRY_PLAN = "start"
WAS = "Free"
NOW = "Boshlang'ich"


def rename(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    # Only the untouched row. A deployment that has already renamed its entry
    # plan to something of its own has answered this question itself.
    Plan.objects.filter(pk=ENTRY_PLAN, name=WAS).update(name=NOW)


def unrename(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    Plan.objects.filter(pk=ENTRY_PLAN, name=NOW).update(name=WAS)


class Migration(migrations.Migration):
    dependencies = [("billing", "0003_plan_script_limit")]

    operations = [migrations.RunPython(rename, unrename)]
