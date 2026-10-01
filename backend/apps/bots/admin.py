from __future__ import annotations

from django.contrib import admin

from .models import Bot, BotActivity, BotChat, BusinessConnection, PaymentConnection


@admin.register(Bot)
class BotAdmin(admin.ModelAdmin):
    list_display = ("handle", "workspace", "project", "kind", "status", "webhook_url")
    list_filter = ("workspace", "kind")
    search_fields = ("handle", "username")
    # The token is the one secret here; the admin shows the mask, not the value.
    exclude = ("token",)
    readonly_fields = ("token_masked", "webhook_secret", "telegram_id")


@admin.register(BotActivity)
class BotActivityAdmin(admin.ModelAdmin):
    list_display = ("bot", "text", "created_at")


@admin.register(BusinessConnection)
class BusinessConnectionAdmin(admin.ModelAdmin):
    list_display = ("bot", "connection_id", "user_name", "is_enabled")


@admin.register(PaymentConnection)
class PaymentConnectionAdmin(admin.ModelAdmin):
    list_display = ("bot", "provider_id", "mode", "status")
    exclude = ("token",)


@admin.register(BotChat)
class BotChatAdmin(admin.ModelAdmin):
    list_display = ("bot", "title", "type", "status", "member_count", "refreshed_at")
    list_filter = ("type", "status")
    search_fields = ("title", "username")
    # Every column here is Telegram's answer, copied. Editing one by hand
    # produces a row that disagrees with the chat it describes until the next
    # refresh silently overwrites it.
    readonly_fields = ("chat_id", "rights", "member_count", "member_count_at", "refreshed_at")
