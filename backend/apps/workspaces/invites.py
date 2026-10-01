"""What an invite code looks like once it has to travel to a person.

Kept out of the view because two things need it and neither is a view: the
endpoint that mints a link, and any future one that reads an existing invite
back. Kept out of the serializer because the addresses it builds are the
deployment's, not the model's — an `Invite` row knows nothing about where the
interface is served from.
"""

from __future__ import annotations

from urllib.parse import quote

from django.conf import settings

from .models import Invite, Workspace


def join_url(code: str) -> str:
    """Where the interface redeems a code.

    A route of its own rather than the onboarding screen with the code
    pre-filled: the person following this link may already have a workspace,
    and that screen belongs to somebody who has none — it sends anyone else
    back to the dashboard, which is exactly the reader who was just invited.
    """
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/join/{code}"


def telegram_share_url(url: str, text: str) -> str:
    """Telegram's own share sheet, pre-filled.

    `t.me/share/url` is the link Telegram documents for this: it opens the
    client with the chat picker up and the message already written, so the
    inviter picks a person instead of copying, switching app and pasting.
    Nothing about it is specific to a bot, which is why it needs none.
    """
    return f"https://t.me/share/url?url={quote(url, safe='')}&text={quote(text, safe='')}"


def invite_link_payload(invite: Invite, workspace: Workspace) -> dict:
    """The link, the share link, and what the reader is being offered.

    `text` is written here rather than in the interface because it travels with
    the URL and the two have to agree about which workspace they name.
    """
    url = join_url(invite.code)
    text = f"«{workspace.name}» ish maydoniga qo'shiling — Oqim Studio"
    return {
        "code": invite.code,
        "role": invite.role,
        "url": url,
        "telegramUrl": telegram_share_url(url, text),
        "expiresAt": invite.expires_at,
    }
