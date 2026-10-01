"""Collapses the repeats already sitting in every bot's activity feed.

`log_activity` counts a repeat instead of writing a second row, but that only
helps the lines written after it. The feeds that exist were written by the code
before it: one install held 3220 rows of which 43 were distinct sentences, and
1811 of them were the single line "Webhook ulanmadi: Unauthorized" against a bot
whose token Telegram will never accept. The panel shows the last eight, so that
feed said one thing eight times and nothing else, and the home screen's summary
of every bot said it too.

This applies the same rule backwards: a run of identical consecutive lines
becomes the newest of them, carrying the same "· N marta" the live path writes.
Nothing that was said is lost — only the repetitions of it, and the count keeps
those.

Irreversible on purpose: the rows it removes said nothing the row it keeps does
not say, and inventing them back would be inventing timestamps.
"""

from __future__ import annotations

from django.db import migrations

#: Kept in step with `services.REPEAT_SUFFIX` and `services.ACTIVITY_TEXT_LIMIT`
#: — copied rather than imported, because a migration has to keep working when
#: the module it came from moves on.
REPEAT_SUFFIX = " · {count} marta"
TEXT_LIMIT = 240


def collapse_repeats(apps, schema_editor):
    BotActivity = apps.get_model("bots", "BotActivity")

    doomed: list[str] = []
    # `.order_by()` first: the model orders by `created_at`, and a `distinct()`
    # under a default ordering distinguishes rows by that column too — which
    # asks here for every (bot, timestamp) pair rather than for the four bots,
    # and turns a second of work into thousands of full scans.
    for bot_id in BotActivity.objects.order_by().values_list("bot_id", flat=True).distinct():
        run: list = []

        def close(run):
            """Keeps the newest row of a run and marks the rest for deletion."""
            if len(run) < 2:
                return
            newest = run[-1]
            newest.text = f"{newest.text[:TEXT_LIMIT]}{REPEAT_SUFFIX.format(count=len(run))}"
            newest.save(update_fields=["text"])
            doomed.extend(entry.id for entry in run[:-1])

        # Oldest first, so a "run" is what the reader would have scrolled past
        # in one block; the row that survives is the newest of it and keeps its
        # own place at the top of the feed.
        for entry in BotActivity.objects.filter(bot_id=bot_id).order_by("created_at").iterator():
            if run and (entry.text, entry.icon) == (run[0].text, run[0].icon):
                run.append(entry)
                continue
            close(run)
            run = [entry]
        close(run)

    for start in range(0, len(doomed), 500):
        BotActivity.objects.filter(id__in=doomed[start : start + 500]).delete()


class Migration(migrations.Migration):
    dependencies = [("bots", "0010_drop_bot_working_hours")]

    operations = [migrations.RunPython(collapse_repeats, migrations.RunPython.noop)]
