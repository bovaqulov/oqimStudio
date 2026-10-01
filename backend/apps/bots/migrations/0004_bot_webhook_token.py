"""Give every bot an unguessable webhook path.

Written by hand rather than generated, because a callable default on a unique
column cannot be added in one step: Django would evaluate `new_secret()` once
and write the *same* value into every existing row, which the unique index then
refuses. So it goes in three — add it nullable and unindexed, fill it a row at
a time, then tighten it.

The URL a bot's webhook lives at changes with this. Nothing has to be
re-registered by hand: `webhook_is_current` compares Telegram's stored URL
against the one `webhook_url_for` now builds, sees them disagree, and the
reconcile pass that already runs on worker boot and every ten minutes puts each
bot back on its new address.
"""

from django.db import migrations, models

import apps.common.models


def fill_tokens(apps_registry, schema_editor):
    Bot = apps_registry.get_model("bots", "Bot")
    for bot in Bot.objects.filter(webhook_token__isnull=True).iterator():
        bot.webhook_token = apps.common.models.new_secret()
        bot.save(update_fields=["webhook_token"])


def drop_tokens(apps_registry, schema_editor):
    """Reversing only has to leave the column fillable; the values are secrets
    and there is nothing to restore them to."""
    Bot = apps_registry.get_model("bots", "Bot")
    Bot.objects.update(webhook_token=None)


class Migration(migrations.Migration):
    dependencies = [
        ("bots", "0003_bot_webhook_actual_url_bot_webhook_last_error_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="bot",
            name="webhook_token",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.RunPython(fill_tokens, drop_tokens),
        migrations.AlterField(
            model_name="bot",
            name="webhook_token",
            field=models.CharField(
                default=apps.common.models.new_secret,
                db_index=True,
                max_length=64,
                unique=True,
            ),
        ),
    ]
