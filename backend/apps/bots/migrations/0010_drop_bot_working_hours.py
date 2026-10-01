"""Takes `workingHours` out of every stored `Bot.settings`.

Six keys — a switch, the weekdays, an opening and a closing time, a timezone
and an away message — under a whole «Ish vaqti» section of the settings screen,
and not one line in this repository read any of them. Not the dispatcher, not
the sender, not the panel. The only code that ever touched the blob was the
form that wrote it back to itself.

It was never one switch away from working, either. Working hours *do* work in
this product, one level down and per flow, where two flows can answer the same
hour differently: a Business trigger carries its own `schedule`, the derived
index keeps it (`flows.services.reindex_triggers`) and
`engine.matching._within_schedule` is what decides. «Ish vaqtidan tashqari
avtojavob» is a shipped template built on exactly that. A bot-level copy was a
second answer to a question that already had one, in the place the first would
be looked for.

Same finding as `0008_drop_bot_fallback_setting` and the same verdict: a
setting written, kept and never read is worse than no setting, because whoever
finds it next will assume it works.

A data migration and not a schema one — `settings` is a `JSONField`, so nothing
here changes a column.
"""

from __future__ import annotations

from django.db import migrations


def drop_working_hours(apps, schema_editor) -> None:
    Bot = apps.get_model("bots", "Bot")
    stale = []
    for bot in Bot.objects.all().iterator():
        settings = bot.settings
        if not isinstance(settings, dict) or "workingHours" not in settings:
            continue
        bot.settings = {key: value for key, value in settings.items() if key != "workingHours"}
        stale.append(bot)
    if stale:
        Bot.objects.bulk_update(stale, ["settings"])


class Migration(migrations.Migration):
    dependencies = [
        ("bots", "0009_bot_is_paused"),
    ]

    operations = [
        migrations.RunPython(
            drop_working_hours,
            # Reverse writes nothing back. The build this migrates down to read
            # the setting through `bot.settings["workingHours"]` with a
            # `default_settings()` fallback for every bot connected before it
            # existed, so a row without the key is a shape that build already
            # handled. Re-inserting a default would invent a schedule nobody
            # chose; the schedules this removes were not consulted by anything
            # and are not recoverable either way, which is what "remove" means.
            migrations.RunPython.noop,
            elidable=False,
        ),
    ]
