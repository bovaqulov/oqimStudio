"""Accounts: who is signed in, and the one-time tokens that let them in.

The email address is the identity — there is no separate username anywhere in
the product, so making it the login field keeps the model and the screens
saying the same thing.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from functools import partial

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.common.models import InterfaceLocale, new_id

# How long a link stays usable. Short enough that a forwarded mail is not a
# standing key, long enough to survive a lunch break.
VERIFY_TOKEN_TTL = timedelta(days=2)
RESET_TOKEN_TTL = timedelta(hours=2)


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email: str, password: str | None = None, **extra):
        if not email:
            raise ValueError("Email majburiy")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("email_verified", True)
        extra.setdefault("name", email.split("@")[0])
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=120)
    #: BCP-47 tag the interface is rendered in for this person. The workspace
    #: has one too; that one is the formatting default for what a team shares,
    #: this one decides the words in front of *this* reader.
    locale = models.CharField(max_length=16, choices=InterfaceLocale.choices, default=InterfaceLocale.UZ)
    #: False until the address is confirmed — the API refuses tenant data until then.
    email_verified = models.BooleanField(default=False)
    #: Set the moment somebody types a name into the settings screen.
    #:
    #: A Telegram account's name follows Telegram — deliberately, so that
    #: renaming yourself there is reflected here. That is the right default and
    #: the wrong answer for exactly one case: an account that has been given a
    #: name of its own. Without this flag, typing one into the profile form and
    #: signing in again would put Telegram's back, which is a setting that
    #: undoes itself — worse than a setting that is not offered at all.
    name_is_custom = models.BooleanField(default=False)

    #: Set when the account was proved by the Telegram Login Widget instead of
    #: by an emailed link. Telegram gives no address, so such an account keeps a
    #: placeholder one and is verified from the moment it exists — the identity
    #: was established by Telegram, which is stronger than a clicked link.
    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    telegram_username = models.CharField(max_length=64, blank=True)
    photo_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.email

    @property
    def workspace_ids(self) -> list[str]:
        return list(self.memberships.values_list("workspace_id", flat=True))


class VerificationToken(models.Model):
    """A single-use link: email confirmation or password reset.

    Both are the same object because they answer the same question — does the
    person holding this string control that mailbox — and one model means one
    place where expiry and single use are enforced.
    """

    class Purpose(models.TextChoices):
        VERIFY_EMAIL = "verify_email", "Emailni tasdiqlash"
        RESET_PASSWORD = "reset_password", "Parolni tiklash"

    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tokens")
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    token = models.CharField(max_length=64, unique=True, default=new_id)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["purpose", "token"])]

    def __str__(self) -> str:
        return f"{self.purpose}:{self.user_id}"

    @classmethod
    def issue(cls, user: User, purpose: str) -> "VerificationToken":
        """Replaces any live token of the same purpose — the newest link is the only one that works."""
        cls.objects.filter(user=user, purpose=purpose, used_at__isnull=True).delete()
        ttl = VERIFY_TOKEN_TTL if purpose == cls.Purpose.VERIFY_EMAIL else RESET_TOKEN_TTL
        return cls.objects.create(user=user, purpose=purpose, expires_at=timezone.now() + ttl)

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and not self.is_expired

    def consume(self) -> None:
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])


#: How long a "sign in through the bot" link is worth opening. Long enough to
#: switch to Telegram and find the chat, short enough that a link left in a
#: browser tab overnight is not a way in.
BOT_LOGIN_TTL = timedelta(minutes=5)


class TelegramLoginRequest(models.Model):
    """One "sign in through the bot" attempt, waiting for its /start.

    The Login Widget needs a domain registered with @BotFather, which is a
    thing nobody can do from inside the product and which stops being true
    every time a development tunnel restarts. This is the way in that has no
    domain in it at all: the panel opens `t.me/<bot>?start=<nonce>`, the person
    presses Start, and the bot's own update carries a Telegram identity that
    Telegram itself authenticated.

    The nonce is the whole security story, so it behaves like a one-time
    password: unguessable, short-lived, usable once, and worthless on its own —
    approving it requires being the person who opened the chat.
    """

    nonce = models.CharField(primary_key=True, max_length=64, default=partial(secrets.token_urlsafe, 32))
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    #: Set when the bot sees the /start carrying this nonce.
    approved_at = models.DateTimeField(null=True, blank=True)
    #: Set when the panel has exchanged it for a session. Never twice.
    consumed_at = models.DateTimeField(null=True, blank=True)

    #: Who pressed Start. Empty until then.
    telegram_id = models.BigIntegerField(null=True, blank=True)
    first_name = models.CharField(max_length=120, blank=True)
    last_name = models.CharField(max_length=120, blank=True)
    username = models.CharField(max_length=64, blank=True)
    photo_url = models.URLField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["expires_at"])]

    def __str__(self) -> str:
        return f"{self.nonce[:8]}… {self.status}"

    @classmethod
    def open(cls) -> "TelegramLoginRequest":
        # Yesterday's attempts are of no use to anybody and the table is a
        # queue, not a log; clearing them here keeps it from growing forever
        # without a scheduled job of its own.
        cls.objects.filter(expires_at__lt=timezone.now() - BOT_LOGIN_TTL).delete()
        return cls.objects.create(expires_at=timezone.now() + BOT_LOGIN_TTL)

    @property
    def is_expired(self) -> bool:
        return self.expires_at <= timezone.now()

    @property
    def status(self) -> str:
        if self.consumed_at:
            return "consumed"
        if self.is_expired:
            return "expired"
        return "approved" if self.approved_at else "pending"

    def approve(self, *, telegram_id: int, first_name: str, last_name: str, username: str, photo_url: str) -> None:
        self.telegram_id = telegram_id
        self.first_name = first_name
        self.last_name = last_name
        self.username = username
        self.photo_url = photo_url
        self.approved_at = timezone.now()
        self.save(
            update_fields=[
                "telegram_id",
                "first_name",
                "last_name",
                "username",
                "photo_url",
                "approved_at",
            ]
        )

    def consume(self) -> None:
        self.consumed_at = timezone.now()
        self.save(update_fields=["consumed_at"])
