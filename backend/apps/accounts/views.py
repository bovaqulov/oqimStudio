"""Auth endpoints.

Two credentials come out of a login: the Django session cookie (what the
Next.js server forwards on the reader's behalf) and a DRF token (what a
WebSocket handshake, a script or the bot runtime uses, none of which have a
cookie jar). Both name the same user; neither is required for the other to
work.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from apps.common.exceptions import ApiError
from apps.common.models import InterfaceLocale
from apps.common.tenancy import WORKSPACE_HEADER, WORKSPACE_PARAM, memberships_of
from apps.workspaces.serializers import WorkspaceSerializer

from . import bot_login
from .models import BOT_LOGIN_TTL, TelegramLoginRequest, User, VerificationToken
from .serializers import (
    ForgotPasswordSerializer,
    LoginSerializer,
    ProfileSerializer,
    ResetPasswordSerializer,
    SignupSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)
from .telegram_auth import TelegramAuthError, verify_init_data, verify_login_payload

#: Telegram sends the secret it was registered with on every update.
WEBHOOK_SECRET_HEADER = "HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN"


class IpRateThrottle(SimpleRateThrottle):
    """Counts by client address, signed in or not.

    Not `AnonRateThrottle`: that one steps aside as soon as a request carries a
    credential, and "resend me another verification mail" is a request from an
    account that already has one.
    """

    def get_cache_key(self, request, view) -> str:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class AuthThrottle(IpRateThrottle):
    """Signing in and signing up: enough for a person, not for a script."""

    scope = "auth"


class AuthPollThrottle(IpRateThrottle):
    """Asking "has it been approved yet" — a poll, not an attempt."""

    scope = "auth-poll"


class AuthEmailThrottle(IpRateThrottle):
    """Anything that puts a message in somebody's inbox."""

    scope = "auth-email"


logger = logging.getLogger(__name__)

VERIFY_MAIL = """Oqim Studio'ga xush kelibsiz!

Emailingizni tasdiqlash uchun havolani oching:
{url}

Yoki shu kodni ilovaga kiriting: {token}

Agar bu siz bo'lmasangiz, xatni e'tiborsiz qoldiring."""

RESET_MAIL = """Parolni tiklash so'rovi keldi.

Yangi parol o'rnatish uchun havolani oching:
{url}

Yoki shu kodni ilovaga kiriting: {token}

Havola 2 soatdan keyin ishlamaydi. Agar bu siz bo'lmasangiz, hech narsa qilmang —
parolingiz o'zgarmaydi."""

#: Long session for "remember me", short one for a shared computer.
REMEMBER_MAX_AGE = 60 * 60 * 24 * 30
SESSION_MAX_AGE = 60 * 60 * 12


def _session_payload(request, user: User) -> dict:
    """The session as the browser is allowed to hold it — no password, no hash.

    The active workspace is the one the caller asked for, *validated against
    their memberships*, falling back to the first one. `role` is the role in
    that workspace and not in some other one — a screen that renders its
    buttons from this must be told about the tenant it is actually showing.
    """
    # Same ordering the API uses to resolve a request without an
    # `X-Workspace-Id` header — a session that named a different default than
    # the one its next call acts on would be a very confusing bug.
    memberships = memberships_of(user)
    requested = request.META.get(WORKSPACE_HEADER) or request.query_params.get(WORKSPACE_PARAM)
    active = next((m for m in memberships if m.workspace_id == requested), None) or (
        memberships[0] if memberships else None
    )
    workspaces = [m.workspace for m in memberships]
    expires_at = request.session.get_expiry_date() if request.session.session_key else None
    return {
        "user": UserSerializer(user).data,
        "workspaceId": active.workspace_id if active else None,
        "memberships": WorkspaceSerializer(workspaces, many=True).data,
        "role": active.role if active else None,
        "expiresAt": int(expires_at.timestamp() * 1000) if expires_at else None,
        "token": Token.objects.get_or_create(user=user)[0].key,
    }


#: Where each kind of link lands in the interface.
LINK_PATHS = {
    VerificationToken.Purpose.VERIFY_EMAIL: "/verify-email?token={token}",
    VerificationToken.Purpose.RESET_PASSWORD: "/reset-password/{token}",
}


def _send_link(user: User, purpose: str, subject: str, body: str) -> VerificationToken:
    """Issues a link and mails it.

    The mail carries both the URL and the bare code: the link is one tap for
    whoever opens the mail on the same device, and the code is what somebody
    reading it on their phone can type into the screen they already have open.

    In development the console mailer prints all of this to the server log
    instead of sending it — see `DJANGO_EMAIL_BACKEND`.
    """
    token = VerificationToken.issue(user, purpose)
    url = settings.FRONTEND_BASE_URL + LINK_PATHS[purpose].format(token=token.token)
    send_mail(
        subject,
        body.format(token=token.token, url=url),
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )
    if settings.DEV_EXPOSE_AUTH_CODES:
        # One obvious line, so a tester with no inbox can find the code without
        # reading a printed MIME message. Never reached with DEBUG off.
        logger.info("DEV auth code for %s (%s): %s — %s", user.email, purpose, token.token, url)
    return token


def _dev_code(token: VerificationToken | None) -> dict:
    """The code, but only where there is no mailbox to open."""
    return {"demoToken": token.token} if token and settings.DEV_EXPOSE_AUTH_CODES else {}


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def signup(request):
    serializer = SignupSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    user = User.objects.create_user(
        email=data["email"],
        password=data["password"],
        name=data["name"],
        locale=data.get("locale", InterfaceLocale.UZ),
        # A test environment with no inbox cannot confirm anything, so the
        # confirmation is skipped rather than faked. Development only.
        email_verified=settings.DEV_AUTO_VERIFY_EMAIL,
    )

    token = None
    if not user.email_verified:
        token = _send_link(
            user,
            VerificationToken.Purpose.VERIFY_EMAIL,
            "Oqim Studio — emailni tasdiqlang",
            VERIFY_MAIL,
        )

    login(request, user)
    request.session.set_expiry(SESSION_MAX_AGE)

    # The address is unverified, so the app shell is still closed to them — and
    # the code comes back only where there is no real mailbox to check.
    return Response({**_session_payload(request, user), **_dev_code(token)}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    user = authenticate(request, username=data["email"].strip().lower(), password=data["password"])
    if user is None:
        # One message for both "no such account" and "wrong password": telling
        # them apart is a free account-existence oracle.
        raise ApiError("invalid_credentials", "Email yoki parol noto'g'ri", status_code=401)

    login(request, user)
    request.session.set_expiry(REMEMBER_MAX_AGE if data.get("remember") else SESSION_MAX_AGE)
    return Response(_session_payload(request, user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    Token.objects.filter(user=request.user).delete()
    logout(request)
    return Response({"ok": True})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def session_view(request):
    """Who is signed in. The screens call this instead of trusting a cookie's contents."""
    if request.method == "PATCH":
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(_session_payload(request, request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([AuthEmailThrottle])
def resend_verification(request):
    if request.user.email_verified:
        return Response({"ok": True, "alreadyVerified": True})
    token = _send_link(
        request.user,
        VerificationToken.Purpose.VERIFY_EMAIL,
        "Oqim Studio — emailni tasdiqlang",
        VERIFY_MAIL,
    )
    return Response({"ok": True, **_dev_code(token)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def verify_email(request):
    serializer = VerifyEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    token = VerificationToken.objects.filter(
        token=serializer.validated_data["token"], purpose=VerificationToken.Purpose.VERIFY_EMAIL
    ).first()
    # Worded for what the reader actually typed. The same value arrives from the
    # emailed link and from the code field, and the screen that shows this has a
    # code field on it — telling somebody their "link" is invalid when they
    # pasted a code reads as a different error entirely.
    if token is None or token.used_at is not None:
        raise ApiError("invalid_token", "Kod noto'g'ri yoki allaqachon ishlatilgan. «Qayta yuborish»ni bosing.")
    if token.is_expired:
        raise ApiError("expired_token", "Kodning muddati o'tgan. «Qayta yuborish»ni bosing.")

    token.consume()
    user = token.user
    user.email_verified = True
    user.save(update_fields=["email_verified"])
    if not request.user.is_authenticated:
        login(request, user)
    return Response(_session_payload(request, user))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthEmailThrottle])
def forgot_password(request):
    serializer = ForgotPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    user = User.objects.filter(email=serializer.validated_data["email"].strip().lower()).first()
    # Always the same answer: whether an address has an account is not something
    # this endpoint is allowed to reveal.
    if user is None:
        return Response({"ok": True, "demoToken": None})

    token = _send_link(
        user,
        VerificationToken.Purpose.RESET_PASSWORD,
        "Oqim Studio — parolni tiklash",
        RESET_MAIL,
    )
    return Response({"ok": True, "demoToken": _dev_code(token).get("demoToken")})


@api_view(["GET"])
@permission_classes([AllowAny])
def reset_token_status(request, token: str):
    """What a reset link resolves to before a new password is accepted."""
    record = VerificationToken.objects.filter(
        token=token, purpose=VerificationToken.Purpose.RESET_PASSWORD
    ).select_related("user").first()
    if record is None or record.used_at is not None:
        return Response({"valid": False, "reason": "invalid_token"})
    if record.is_expired:
        return Response({"valid": False, "reason": "expired_token"})

    name, _, domain = record.user.email.partition("@")
    return Response({"valid": True, "emailMasked": f"{name[:2]}•••@{domain}"})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def reset_password(request):
    serializer = ResetPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    record = VerificationToken.objects.filter(
        token=serializer.validated_data["token"], purpose=VerificationToken.Purpose.RESET_PASSWORD
    ).select_related("user").first()
    if record is None or record.used_at is not None:
        raise ApiError("invalid_token", "Bu havola yaroqsiz")
    if record.is_expired:
        raise ApiError("expired_token", "Havolaning muddati tugagan")

    user = record.user
    user.set_password(serializer.validated_data["password"])
    user.save(update_fields=["password"])
    record.consume()
    # Every other session belonged to whoever had the old password.
    Token.objects.filter(user=user).delete()
    return Response({"ok": True})
