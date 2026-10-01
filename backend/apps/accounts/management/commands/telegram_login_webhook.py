"""Registers (or removes) the login bot's webhook.

Separate from the per-workspace bots on purpose: this one belongs to the
deployment, not to a tenant, and it exists so somebody can sign in without a
password. The URL follows `PUBLIC_BASE_URL`, so re-run this whenever the
tunnel in front of the backend changes.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.accounts import bot_login
from apps.telegram.client import TelegramError


class Command(BaseCommand):
    help = "Telegram orqali kirish uchun bot webhookini o'rnatadi."

    def add_arguments(self, parser):
        parser.add_argument("--remove", action="store_true", help="Webhookni o'chiradi")

    def handle(self, *args, **options):
        if not bot_login.is_configured():
            raise CommandError("TELEGRAM_LOGIN_BOT_TOKEN va TELEGRAM_LOGIN_BOT_USERNAME .env da to'ldirilmagan.")

        try:
            if options["remove"]:
                bot_login.remove_webhook()
                self.stdout.write(self.style.SUCCESS("Webhook o'chirildi."))
                return

            info = bot_login.install_webhook()
        except TelegramError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(f"Webhook o'rnatildi: {bot_login.webhook_url()}"))
        pending = info.get("pending_update_count")
        if info.get("last_error_message"):
            self.stdout.write(self.style.WARNING(f"Telegram oxirgi xatosi: {info['last_error_message']}"))
        if pending:
            self.stdout.write(f"Kutayotgan update: {pending}")
