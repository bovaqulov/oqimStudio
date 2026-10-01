"""Adds `Flow.layout_mode`, and clears rows whose flow is already gone.

The second half is not decoration. SQLite only enforces foreign keys when
`PRAGMA foreign_keys` is on, and a database that ran with it off can hold a
run, a step or a trigger pointing at a flow nobody kept — which Django's own
post-migration constraint check then refuses, blocking *every* later migration
on that database. The rows are unreachable by definition (no flow, so no screen
and no runtime path reaches them), so removing them costs nothing and unblocks
the schema change that follows.

`FlowTrigger` matters most of the three: it is what the dispatcher matches an
incoming update against, so a row still standing for a deleted flow is a rule
the runtime could try to answer with a graph that no longer exists.
"""

from django.db import migrations, models


def drop_orphaned_rows(apps, schema_editor):
    Flow = apps.get_model("flows", "Flow")
    FlowRun = apps.get_model("flows", "FlowRun")
    FlowRunStep = apps.get_model("flows", "FlowRunStep")
    FlowTrigger = apps.get_model("flows", "FlowTrigger")

    live = Flow.objects.values("id")
    orphaned_runs = FlowRun.objects.exclude(flow_id__in=live)
    # Steps go first: they hang off the run, and the same missing-parent
    # problem would simply move down one table.
    FlowRunStep.objects.filter(run_id__in=orphaned_runs.values("id")).delete()
    orphaned_runs.delete()
    FlowTrigger.objects.exclude(flow_id__in=live).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('flows', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(drop_orphaned_rows, migrations.RunPython.noop),
        migrations.AddField(
            model_name='flow',
            name='layout_mode',
            field=models.CharField(choices=[('simple', 'Oddiy'), ('pro', 'Pro')], default='simple', max_length=8),
        ),
    ]
