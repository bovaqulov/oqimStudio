"""Model plumbing every app shares."""

from __future__ import annotations

import secrets

from django.db import models


class InterfaceLocale(models.TextChoices):
    """Which language the *studio* is rendered in.

    Deliberately not `apps.common.i18n.LANGUAGES`, which answers a different
    question — that one is what a bot says to a customer in Telegram, and the
    two lists are free to diverge the day the studio ships a language no bot
    template has been written in.

    Stored as a full BCP-47 tag rather than as "uz": the same column decides
    which words the interface uses *and* stands in for a region when a date or
    a currency is formatted, and "uz" alone cannot answer the second question.

    A model's `choices` is not enforced by `save()` — only `full_clean()` reads
    it — but DRF turns a model field carrying them into a `ChoiceField`, which
    is what actually closes the API: `locale` used to accept any sixteen
    characters. The serializers that declare the field by hand rather than
    through the model say `ChoiceField` for the same reason. Without both, a
    mistyped tag stores cleanly, comes back through the API, and leaves the
    interface silently falling back to Uzbek with nothing anywhere saying why.
    """

    UZ = "uz-UZ", "O'zbekcha"
    RU = "ru-RU", "Русский"
    EN = "en-US", "English"


def new_id(prefix: str = "") -> str:
    """A short, URL-safe, sortable-enough id.

    Primary keys are strings on purpose: the interface, the seed data and the
    Telegram side all refer to records by readable handles ("sunrise-academy-bot"),
    and an integer key would need a second lookup table to keep them.
    """
    token = secrets.token_hex(8)
    return f"{prefix}{token}" if prefix else token


def new_secret() -> str:
    """A value meant to be unguessable, not merely unique.

    `new_id` is 64 bits — plenty to keep two rows apart, and nowhere near
    enough for something that stands in a URL as the only thing between the
    public internet and an endpoint. This is 256 bits of `secrets`, URL-safe,
    which is the size you use when the guess is the attack.
    """
    return secrets.token_urlsafe(32)
