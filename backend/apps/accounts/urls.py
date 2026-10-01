"""Auth routes. Mounted under `/api/auth/` by `config/urls.py`."""

from __future__ import annotations

from django.urls import path

from . import telegram_views, views

urlpatterns = [
    path("signup/", views.signup, name="signup"),
    path("login/", views.login_view, name="login"),
    path("telegram/", telegram_views.telegram_login, name="telegram-login"),
    path("telegram/webapp/", telegram_views.telegram_webapp_login, name="telegram-webapp-login"),
    path("telegram/config/", telegram_views.telegram_config, name="telegram-config"),
    path("telegram/start/", telegram_views.telegram_bot_start, name="telegram-bot-start"),
    path("telegram/status/", telegram_views.telegram_bot_status, name="telegram-bot-status"),
    path("telegram/bot/", telegram_views.telegram_bot_webhook, name="telegram-bot-webhook"),
    path("logout/", views.logout_view, name="logout"),
    path("session/", views.session_view, name="session"),
    path("verify-email/", views.verify_email, name="verify-email"),
    path("resend-verification/", views.resend_verification, name="resend-verification"),
    path("forgot-password/", views.forgot_password, name="forgot-password"),
    path("reset-password/", views.reset_password, name="reset-password"),
    path("reset-password/<str:token>/", views.reset_token_status, name="reset-token-status"),
]
