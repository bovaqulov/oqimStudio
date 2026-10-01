"""Gives «To'xtatish» something to write.

The button existed in the bot header's overflow menu, behind a destructive
confirmation reading *"Bot to'xtatiladi va xabarlarga javob bermaydi"*. It
fired a toast and nothing else: no request left the browser, so the bot went on
answering customers while the panel said it had been stopped.

A column rather than a deleted webhook, because a deleted webhook is not
something this product can keep: `services.reconcile_webhooks` re-registers
every bot with a token on boot, on `worker_ready` and every ten minutes, and
`BotViewSet.retrieve` repairs one the moment anybody opens its page.
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("bots", "0008_drop_bot_fallback_setting"),
    ]

    operations = [
        migrations.AddField(
            model_name="bot",
            name="is_paused",
            field=models.BooleanField(default=False),
        ),
    ]
