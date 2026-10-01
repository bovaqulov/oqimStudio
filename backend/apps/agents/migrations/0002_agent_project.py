"""An agent belongs to a project.

**Where the agents that already exist go, and why.**

Every existing agent lands in the **oldest project of its own workspace**.
Oldest and not newest because that is the project the workspace was actually
built around: the one the first bot was connected under, and therefore the one
the agent was almost certainly written for. Ties break on the id so the answer
is the same on every machine this runs on, which matters — a migration that
places a row differently on the developer's box and on production is a bug that
only ever reproduces once.

**A workspace with agents and no project at all.** It happens: nothing has ever
created a project automatically, projects are made by hand from the panel, and
until now an agent needed no project to exist. Three ways out were on the
table:

  * leave `project` null for them. Rejected — a null project is an agent no
    screen lists, no picker offers and no flow may call, which is the whole row
    lost while the table still holds it. "No rows deleted" is not the same as
    "no data lost".
  * delete those agents. Rejected outright: an instruction somebody wrote is
    not this migration's to throw away.
  * give the workspace the project it never made, and put its agents in it.
    That is what happens below.

The made project is named after the workspace and carries the ordinary
defaults, so it is an unremarkable folder the owner can rename, move things
into, or delete once they have moved the agents out. Its handle and id are
built the same way `projects.serializers.ProjectSerializer.create` builds them
(`slugify(name)`, id `<workspace>-<handle>`), so a project born here is
indistinguishable from one born through the API — a second shape of project id
would be a thing to remember forever.

**The name constraint moves with the column.** `(workspace, name)` becomes
`(project, name)`: two projects in one workspace may now each have a
«Qabulxona», which is the ordinary case once an agent belongs to a project. The
new rule is strictly weaker than the old one, so no existing row can violate
it — the constraint is swapped after the data is placed all the same, because
the placement is what makes it meaningful.
"""

from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models
from django.utils.text import slugify


def _home_project(Project, workspace):
    """The project a workspace that never made one gets, so its agents keep a home."""
    base = slugify(workspace.name)[:48] or "loyiha"
    handle = base
    suffix = 2
    while Project.objects.filter(workspace_id=workspace.pk, handle=handle).exists():
        handle = f"{base}-{suffix}"
        suffix += 1
    return Project.objects.create(
        id=f"{workspace.pk}-{handle}"[:64],
        workspace_id=workspace.pk,
        name=workspace.name or "Loyiha",
        handle=handle,
        description="Agentlar loyihaga ko'chirilganda ochilgan loyiha.",
    )


def place_agents_in_projects(apps, schema_editor):
    Agent = apps.get_model("agents", "Agent")
    Project = apps.get_model("projects", "Project")
    Workspace = apps.get_model("workspaces", "Workspace")

    workspace_ids = sorted(set(Agent.objects.values_list("workspace_id", flat=True)))
    for workspace_id in workspace_ids:
        project = Project.objects.filter(workspace_id=workspace_id).order_by("created_at", "id").first()
        if project is None:
            workspace = Workspace.objects.filter(pk=workspace_id).first()
            if workspace is None:
                # A workspace row cannot be missing while its agents are still
                # here — `Agent.workspace` cascades. Nothing sensible is left
                # to do for such a row, and inventing a project for a tenant
                # that does not exist is worse than leaving it to the NOT NULL
                # that follows.
                continue
            project = _home_project(Project, workspace)
        Agent.objects.filter(workspace_id=workspace_id).update(project=project)


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0001_initial"),
        ("projects", "0001_initial"),
        ("workspaces", "0003_alter_workspace_locale"),
    ]

    operations = [
        # Nullable first, filled second, required third. A column added NOT
        # NULL needs a default, and the only default available here is a
        # literal — which is exactly the wrong project for every workspace but
        # one.
        migrations.AddField(
            model_name="agent",
            name="project",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agents",
                to="projects.project",
            ),
        ),
        migrations.RunPython(place_agents_in_projects, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="agent",
            name="project",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agents",
                to="projects.project",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="agent",
            name="agent_name_unique_per_workspace",
        ),
        migrations.AddConstraint(
            model_name="agent",
            constraint=models.UniqueConstraint(fields=("project", "name"), name="agent_name_unique_per_project"),
        ),
        migrations.AlterField(
            model_name="agentrun",
            name="reason",
            field=models.CharField(
                choices=[
                    ("ok", "Javob berildi"),
                    ("tool_handoff", "Model operator so'radi"),
                    ("empty", "Bo'sh javob"),
                    ("refused", "Model javob berishdan bosh tortdi"),
                    ("blocked", "Javob tekshiruvdan o'tmadi"),
                    ("turns", "Qadamlar tugadi"),
                    ("budget", "Kunlik byudjet tugadi"),
                    ("plan", "Tarif chegarasi"),
                    ("unavailable", "Sozlanmagan"),
                    ("project", "Agent boshqa loyihaniki"),
                    ("error", "Xato"),
                ],
                default="ok",
                max_length=24,
            ),
        ),
    ]
