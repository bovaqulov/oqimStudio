from __future__ import annotations

from django.apps import AppConfig


class AgentsConfig(AppConfig):
    default_auto_field = "django.db.models.AutoField"
    name = "apps.agents"
    verbose_name = "AI agentlar"
