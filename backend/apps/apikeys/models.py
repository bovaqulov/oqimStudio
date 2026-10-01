"""API keys — a credential that belongs to a workspace, not to a person.

The product already had a credential an outside program could hold: DRF's
`Token`, handed out by `/api/auth/login/`. It is the wrong thing to give a CRM
integration and it is worth saying exactly why, because "we already have a
token" is the answer somebody will reach for again.

A DRF token *is the account*. It carries every membership its owner has, in
every workspace they belong to; it opens the bot tokens (`/reveal-token/`), the
payment connections, the invoices and the team screen; it has no scope, no
expiry and no name, so a list of them says nothing about what they are for. The
only way to withdraw one is to rotate it, which signs the person out of the
panel at the same time. Handing that to another program is not integration, it
is lending somebody your account.

An `ApiKey` is the opposite of each of those:

- it names one workspace and can never see another one,
- it carries a fixed set of `scopes` and is refused outside them,
- it is created and revoked as a thing of its own, without touching anybody's
  sign-in,
- and the full key exists in exactly one response, once.

## What is stored

Never the key. `hashed` is a single SHA-256 of the whole string and the lookup
is done *by* that digest, which is why it is unique and indexed.

**Why not a password hasher.** PBKDF2 (Django's default, ~600 000 iterations)
is slow on purpose: a human password has perhaps 30 bits of entropy behind it,
so the only defence is making each guess expensive. A key here is 32 characters
drawn from a 62-character alphabet — about 190 bits — and no amount of hardware
gets through that at any cost per guess. The slowness would buy nothing and
would be paid on *every request*, which is the other half of it: a salted hash
cannot be looked up. With PBKDF2 the authentication path would have to read
every key row in the workspace — and it cannot even know the workspace yet —
and verify each one at 100 ms. SHA-256 makes it one indexed `WHERE hashed = ?`.

Rainbow tables and timing are the two objections to a fast unsalted hash, and
neither applies to a value the server generated with 190 bits of `secrets`:
there is nothing to precompute and nothing an attacker could steer a guess
towards.

## Who owns a key when its creator leaves

The key does **not** stop working, and that is a deliberate answer rather than
an oversight.

A key is workspace infrastructure. The integration on the other end of it is a
CRM that has been filing leads for eight months; nobody there knows or cares
which employee pasted the string in. Revoking on departure means an ordinary HR
event silently takes a production integration down, at a moment nobody is
watching, and the symptom appears at the customer rather than at the person who
caused it. It also makes the failure undiagnosable from the panel: the key is
gone, so there is nothing left to explain the outage.

So `created_by` is `SET_NULL` and the row survives — but survival is only
defensible if leaving is *visible*, so two things go with it:

- `created_by_name` is a snapshot taken at creation. When the account is
  deleted outright the audit line still reads «Aziza» instead of «—», which is
  the one thing an admin reviewing keys actually needs.
- `last_used_at` says whether the key is still doing anything at all. A key
  whose creator left and which nothing has called for two months is visible in
  the list as exactly that, and revoking it is one click.

Departure is therefore a prompt to review, not an automatic revocation. The
review is a human decision because only a human knows whether the departing
person *was* the integration.

## Expiry

There is no `expires_at`, and this is also a decision.

An expiry date is a promise: "we will warn you, and you will rotate before it
matters". Keeping it needs a rotation flow (mint the replacement before killing
the old one), a warning somebody actually receives, and a grace period. None of
those exist here. Shipping the column without them buys an integration that
stops at 03:00 on a date nobody remembers agreeing to, with an error the far
side reads as "your API is broken".

What genuinely reduces the risk of a forgotten key is knowing it is forgotten,
and that is `last_used_at`. `revoked_at` is the off switch, and it is
immediate. When there is a rotation flow to hang it off, expiry is a nullable
column and a one-line migration; until then it would be theatre.
"""

from __future__ import annotations

import hashlib
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.common.models import new_id
from apps.workspaces.models import Workspace

#: Everything a key may be given, and how each one reads in the panel.
#:
#: Four, and deliberately not five. A scope is a promise that something on the
#: other side of it exists and is supported; inventing `bots:write` for an
#: endpoint nobody has written means the first caller to tick it finds out by
#: getting a 404 from a door we told them they could open.
#:
#: `flows:write` does not imply `flows:read`. They are separate ticks because
#: they are separate risks — a key that may upload a flow but may not enumerate
#: what a workspace has drawn is a reasonable thing to want, and implication
#: would quietly take that away.
SCOPES: dict[str, str] = {
    "flows:read": "Oqimlarni o'qish",
    "flows:write": "Oqim yuklash va grafni almashtirish",
    "bots:read": "Botlar ro'yxatini o'qish",
    "contacts:read": "Kontaktlarni o'qish",
}

#: The visible half of the shape. `live` rather than nothing at all because the
#: day there is a sandbox this is the character that tells the two apart, and a
#: key already pasted into somebody's config cannot grow a discriminator later.
KEY_PREFIX = "oq_live_"

#: 32 characters of base62 — about 190 bits. See the module docstring for why
#: the number matters more than the hash.
SECRET_LENGTH = 32
ALPHABET = string.ascii_letters + string.digits

#: How much of the secret the panel is allowed to show. Four characters is
#: enough to tell two keys apart in a list and leaves ~166 bits in the part
#: nobody ever sees again.
PREFIX_VISIBLE = 4

#: How stale `last_used_at` is allowed to be. The column answers "is anything
#: still calling with this key", and a minute answers it; writing on every
#: request would put a row update on the read path of an API meant to be read
#: from.
TOUCH_INTERVAL = timedelta(seconds=60)


def generate_secret() -> str:
    """The whole key, exactly once. Nothing stores this."""
    body = "".join(secrets.choice(ALPHABET) for _ in range(SECRET_LENGTH))
    return f"{KEY_PREFIX}{body}"


def hash_key(raw: str) -> str:
    """The only form of a key that is ever written down."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def prefix_of(raw: str) -> str:
    """The part a list may show — the shape, plus four characters to tell keys apart."""
    return raw[: len(KEY_PREFIX) + PREFIX_VISIBLE]


def normalise_scopes(scopes) -> list[str]:
    """Known scopes only, de-duplicated, in the order `SCOPES` declares them.

    A stored order of somebody's checkbox clicks would make two identical keys
    compare as different, and the panel renders this list directly.
    """
    given = {str(scope) for scope in (scopes or [])}
    return [scope for scope in SCOPES if scope in given]


class ApiKey(models.Model):
    id = models.CharField(primary_key=True, max_length=40, default=new_id, editable=False)
    #: The one tenant this key can ever see. Not nullable and not changeable:
    #: re-pointing a key at another workspace is minting a new key, and it
    #: should look like one to everybody watching.
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="api_keys")
    #: What it is for, in the words of whoever made it («CRM ulanish»). The
    #: only thing standing between an admin and "what are these six keys".
    name = models.CharField(max_length=120)
    prefix = models.CharField(max_length=32)
    #: SHA-256 of the whole key. Unique because it is the lookup, indexed
    #: because that lookup happens on every request the public API serves.
    hashed = models.CharField(max_length=64, unique=True, db_index=True)
    scopes = models.JSONField(default=list)
    #: `SET_NULL`, not `CASCADE` — see the module docstring. A deleted account
    #: must not take a workspace's integrations down with it.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="api_keys_created",
    )
    #: The name at the moment of creation, so the audit line survives the FK
    #: going null. Denormalised on purpose: this is a record of who did
    #: something, and a record that empties itself is not one.
    created_by_name = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    #: Set instead of deleting the row. A revoked key is the only thing left
    #: that can answer "what was that, and had it been used" — and its
    #: `last_used_at` is precisely the question asked after a leak.
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["workspace", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.prefix}… ({self.name})"

    @property
    def is_usable(self) -> bool:
        return self.revoked_at is None

    @property
    def scope_list(self) -> list[str]:
        """Stored scopes, filtered back through the vocabulary on the way out.

        A scope removed from `SCOPES` in a later version must stop opening
        doors immediately, without a data migration going round every row —
        the alternative is a string in a JSON column outliving the feature it
        named.
        """
        return normalise_scopes(self.scopes)

    def has_scope(self, scope: str) -> bool:
        return scope in self.scope_list

    def touch(self) -> None:
        """Records that the key was used, at most once a minute.

        A queryset `update` rather than `save`: two concurrent requests with
        the same key must not write each other's stale copy of every other
        column back over the row.
        """
        now = timezone.now()
        if self.last_used_at is not None and now - self.last_used_at < TOUCH_INTERVAL:
            return
        ApiKey.objects.filter(pk=self.pk).update(last_used_at=now)
        self.last_used_at = now


def issue_key(*, workspace, name: str, scopes, created_by=None) -> tuple[ApiKey, str]:
    """Mints a key and hands back the row **and** the one copy of the secret.

    A tuple and not a field on the model, so there is no attribute anywhere
    that a future serializer could pick up by accident: the raw string exists
    as a local variable in the one view that returns it and nowhere else.
    """
    raw = generate_secret()
    key = ApiKey.objects.create(
        workspace=workspace,
        name=name.strip(),
        prefix=prefix_of(raw),
        hashed=hash_key(raw),
        scopes=normalise_scopes(scopes),
        created_by=created_by,
        created_by_name=getattr(created_by, "name", "") or "",
    )
    return key, raw
