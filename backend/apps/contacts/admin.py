from __future__ import annotations

from django.contrib import admin

from .models import Contact, ContactTag


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ("display_name", "bot", "username", "is_blocked", "last_seen_at")
    list_filter = ("bot", "is_blocked")
    search_fields = ("first_name", "last_name", "username")


@admin.register(ContactTag)
class ContactTagAdmin(admin.ModelAdmin):
    list_display = ("contact", "name", "created_at")
