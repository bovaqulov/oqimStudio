"""Takes `fallback` out of every stored `Bot.settings`.

The safety net it configured is gone: `engine/fallback.py` was deleted and
nothing in the runtime reads the key any more. What was left was seven fields a
settings form still round-tripped into the database and nobody consulted — and
a setting that is written, kept and never read is a setting that will one day
be read wrongly, by someone who finds it and assumes it works.

This is a data migration and not a schema one: `settings` is a `JSONField` and
its shape is not in the table definition, so nothing here changes a column.
"""

from __future__ import annotations

from django.db import migrations


def drop_fallback(apps, schema_editor) -> None:
    Bot = apps.get_model("bots", "Bot")
    stale = []
    for bot in Bot.objects.all().iterator():
        settings = bot.settings
        if not isinstance(settings, dict) or "fallback" not in settings:
            continue
        bot.settings = {key: value for key, value in settings.items() if key != "fallback"}
        stale.append(bot)
    if stale:
        Bot.objects.bulk_update(stale, ["settings"])


class Migration(migrations.Migration):

    dependencies = [
        ("bots", "0007_botchat"),
    ]

    operations = [
        migrations.RunPython(
            drop_fallback,
            # Reverse writes nothing back, deliberately. The build this migrates
            # down to read the setting through `Bot.fallback`, which merged
            # `default_fallback()` over whatever was stored — so a row with no
            # `fallback` key is exactly the shape that build was written to
            # handle, and it is the shape every bot connected before the setting
            # existed already had. Re-inserting a default here would invent a
            # menu nobody configured; the customised menus this migration
            # removes are not recoverable either way, which is what "remove"
            # means.
            migrations.RunPython.noop,
            elidable=False,
        ),
    ]
