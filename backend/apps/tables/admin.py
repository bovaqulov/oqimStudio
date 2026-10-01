from __future__ import annotations

from django.contrib import admin

from .models import Table, TableRow


@admin.register(Table)
class TableAdmin(admin.ModelAdmin):
    list_display = ("name", "handle", "workspace", "bot", "updated_at")
    list_filter = ("workspace",)
    search_fields = ("name", "handle")
    # The secret is the whole security of the open endpoint; a list page that
    # printed it would put it in every screenshot of this admin.
    exclude = ("webhook_secret",)


@admin.register(TableRow)
class TableRowAdmin(admin.ModelAdmin):
    list_display = ("id", "table", "created_at")
    list_filter = ("table",)
