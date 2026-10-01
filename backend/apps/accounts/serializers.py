"""Auth payloads, in the shape the interface already reads.

Field names are camelCase on purpose: these objects are the `AuthUser` and
`AuthSession` types in `frontend/src/features/auth/types.ts`, and a backend that
renames them would make every screen do the translating instead.
"""

from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.common.exceptions import ApiError
from apps.common.models import InterfaceLocale

from .models import User


class UserSerializer(serializers.ModelSerializer):
    emailVerified = serializers.BooleanField(source="email_verified", read_only=True)
    workspaceIds = serializers.SerializerMethodField()
    #: Whether Telegram established this identity, rather than an emailed link.
    #:
    #: The address such an account carries is the synthetic
    #: `tg<id>@telegram.local` minted in `telegram_views` — plumbing, and the
    #: same thing `projects.serializers` already refuses to show a reader. The
    #: settings screen drew it in a field labelled "Email", which presents an
    #: address nobody owns as the one the account is reachable at. It needs to
    #: know which kind of account it is looking at in order not to.
    viaTelegram = serializers.SerializerMethodField()
    telegramUsername = serializers.CharField(source="telegram_username", read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "name", "email", "locale", "emailVerified", "workspaceIds",
            "viaTelegram", "telegramUsername",
        ]

    def get_viaTelegram(self, user: User) -> bool:  # noqa: N802 - contract is camelCase
        return user.telegram_id is not None

    def get_workspaceIds(self, user: User) -> list[str]:  # noqa: N802 - contract is camelCase
        return user.workspace_ids


class SignupSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    #: Declared here rather than taken from the model, so it says the same
    #: thing the model field does — an unlisted tag is a 400, not a stored typo.
    locale = serializers.ChoiceField(choices=InterfaceLocale.choices, required=False, default=InterfaceLocale.UZ)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email=email).exists():
            raise ApiError("email_taken", "Bu email allaqachon ro'yxatdan o'tgan", field="email")
        return email

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise ApiError("weak_password", " ".join(exc.messages), field="password") from exc
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    #: Long session vs. one that ends with the browser day.
    remember = serializers.BooleanField(required=False, default=False)


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(min_length=8, write_only=True)

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise ApiError("weak_password", " ".join(exc.messages), field="password") from exc
        return value


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class ProfileSerializer(serializers.ModelSerializer):
    """What someone may change about themselves. The email is not on the list —
    changing it re-opens the verification question and has its own flow."""

    class Meta:
        model = User
        fields = ["name", "locale"]

    def update(self, instance: User, validated_data: dict) -> User:
        # A name that arrived here was typed by the person it belongs to, so it
        # stops following Telegram — see `User.name_is_custom` and
        # `telegram_views._user_for_telegram`. Only when a name is actually in
        # the patch: this endpoint is also how the language is saved, and
        # changing the language must not claim anything about the name.
        if "name" in validated_data and not instance.name_is_custom:
            instance.name_is_custom = True
        return super().update(instance, validated_data)
