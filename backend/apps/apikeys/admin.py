from __future__ import annotations

from django.contrib import admin

from .models import ApiKey


@admin.register(ApiKey)
class ApiKeyAdmin(admin.ModelAdmin):
    """Read-only on the secret side: `hashed` is shown, never editable.

    Hand-editing a digest would either lock a key out or, worse, let somebody
    paste in the hash of a string they chose — which is minting a key without
    the audit row that says so.
    """

    list_display = ["prefix", "name", "workspace", "created_by_name", "created_at", "last_used_at", "revoked_at"]
    list_filter = ["workspace", "revoked_at"]
    search_fields = ["name", "prefix"]
    readonly_fields = ["id", "prefix", "hashed", "created_at", "last_used_at"]
