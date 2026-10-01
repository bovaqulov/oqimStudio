"""Shared ground for the engine suite: updates as Telegram sends them, a
seeded workspace with one bot, and the intake graph most scenarios walk.

Test modules do `from .base import *` — this is the one place the imports
and fixtures live, so a new scenario file starts at its first test.
"""

from __future__ import annotations
"""Runtime tests.

These drive the real path — parse an update, match a trigger, walk the graph —
with `TELEGRAM_OFFLINE` standing in for the Bot API. What is asserted is what a
customer would see: which flow answered, what it sent, and where the run parked.
"""


import itertools
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.accounts.models import User
from apps.bots.models import Bot, PaymentConnection
from apps.contacts.models import Contact
from apps.engine.dispatch import dispatch
from apps.flows.models import Flow, FlowRun, FlowTrigger
from apps.flows.services import reindex_triggers
from apps.projects.models import Project
from apps.telegram.client import TelegramClient, TelegramError
from apps.workspaces.models import Membership, Role, Workspace

#: Telegram never repeats an update id, and since the runtime now refuses a
#: repeat, neither may the helper that stands in for it.
_update_ids = itertools.count(1000)

def message_update(text: str, user_id: int = 555, chat_type: str = "private") -> dict:
    return {
        "update_id": next(_update_ids),
        "message": {
            "message_id": 10,
            "chat": {"id": user_id, "type": chat_type},
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "text": text,
        },
    }


def callback_update(data: str, user_id: int = 555) -> dict:
    return {
        "update_id": next(_update_ids),
        "callback_query": {
            "id": "cq1",
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "message": {"message_id": 11, "chat": {"id": user_id, "type": "private"}},
            "data": data,
        },
    }


#: How a chosen language arrives on the wire — a callback carrying the code
#: behind `sender.LANGUAGE_PREFIX`. `pick_language("uz")` resumes an
#: `intake_graph` run parked on its language block.
LANGUAGE_PREFIX = "lang:"


def pick_language(code: str = "uz", user_id: int = 555) -> dict:
    """The callback a tapped language row sends — how an intake run is resumed."""
    return callback_update(f"{LANGUAGE_PREFIX}{code}", user_id=user_id)


def intake_graph() -> tuple[list[dict], list[dict]]:
    """A one-question intake as a bot's main flow: pick a language, thank you.

    Its own fixture rather than `flows.services.starter_graph()`, which is what
    these tests used to lean on. That graph is the product's opening offer and
    it changes with the product, while what is being tested here is the
    runtime's behaviour around a block that *parks*: one prompt per update, a
    parked run that stays parked, an answer that reaches the contact.

    It was a two-question name/phone intake until «Savol» was removed from the
    product; «Til tanlash» is the block that survived with the same park-then-
    resume shape, so the fixture asks for a language and resumes on the tap
    (`pick_language`). The chosen code lands on the contact as `mijoz_tili`.
    """
    nodes = [
        {"id": "n1", "type": "start", "x": 300, "y": 40, "title": "start", "channel": "tg", "scopes": ["private"],
         "text": ""},
        {"id": "n2", "type": "language", "x": 300, "y": 200, "title": "Til", "channel": "tg", "scopes": ["private"],
         "text": "Tilni tanlang.",
         "language": {"options": [
             {"id": "o1", "code": "uz", "label": "O'zbekcha"},
             {"id": "o2", "code": "ru", "label": "Ruscha"},
         ]}},
        {"id": "n4", "type": "message", "x": 300, "y": 520, "title": "Tasdiq", "channel": "tg",
         "scopes": ["private"],
         "text": "Rahmat! Ma'lumotlaringiz qabul qilindi — tez orada bog'lanamiz."},
    ]
    edges = [
        {"id": "e1", "from": "n1", "port": "out", "to": "n2"},
        {"id": "e2", "from": "n2", "port": "out", "to": "n4"},
    ]
    return nodes, edges


class EngineTestCase(TestCase):
    """One workspace, one bot, and whatever graph the test needs."""

    def make_intake_flow(self):
        """This bot's main flow, built from [[intake_graph]]."""
        from apps.flows.services import ensure_main_flow

        return ensure_main_flow(
            workspace=self.workspace, project=self.project, bot=self.bot, graph=intake_graph()
        )

    def setUp(self) -> None:
        self.user = User.objects.create_user(email="a@b.uz", password="Parol12345", name="Aziza", email_verified=True)
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(
            workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER
        )
        self.project = Project.objects.create(
            id="p", workspace=self.workspace, name="P", handle="p", created_by=self.user
        )
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t", enabled_modules=["dms"]
        )

    def make_flow(self, nodes, edges, *, module_key="dms", enabled=True, **extra) -> Flow:
        flow = Flow.objects.create(
            workspace=self.workspace,
            project=self.project,
            bot=self.bot,
            module_key=module_key,
            name=extra.pop("name", "Oqim"),
            enabled=enabled,
            nodes=nodes,
            edges=edges,
            **extra,
        )
        reindex_triggers(flow)
        return flow


def contact_share_update(user_id: int = 555, phone: str = "+998901112233") -> dict:
    """What a tapped `request_contact` row sends back — a contact, no text."""
    return {
        "update_id": next(_update_ids),
        "message": {
            "message_id": 14,
            "chat": {"id": user_id, "type": "private"},
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "contact": {"phone_number": phone, "first_name": "Dilnoza", "user_id": user_id},
        },
    }


def web_app_update(data: str, user_id: int = 555, button_text: str = "Anketani to'ldirish") -> dict:
    """What a Mini App's `sendData` arrives as — a service message, no text.

    Only a Mini App opened from a *keyboard* button can send one; the field is
    `Message.web_app_data`, and both of its members are documented as things
    "a bad client can send arbitrary data in", which is why the fixtures below
    put a bare token in `data` rather than the answers themselves.
    https://core.telegram.org/bots/api#webappdata
    """
    return {
        "update_id": next(_update_ids),
        "message": {
            "message_id": 15,
            "chat": {"id": user_id, "type": "private"},
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "web_app_data": {"data": data, "button_text": button_text},
        },
    }


def payment_update(payload: str = "n2", total: int = 5000, currency: str = "UZS", user_id: int = 555) -> dict:
    return {
        "update_id": next(_update_ids),
        "message": {
            "message_id": 12,
            "chat": {"id": user_id, "type": "private"},
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "successful_payment": {
                "currency": currency,
                "total_amount": total,
                "invoice_payload": payload,
                "telegram_payment_charge_id": "ch1",
                "provider_payment_charge_id": "pp1",
            },
        },
    }


def pre_checkout_update(query_id: str = "pc1", user_id: int = 555) -> dict:
    return {
        "update_id": next(_update_ids),
        "pre_checkout_query": {
            "id": query_id,
            "from": {"id": user_id, "first_name": "Dilnoza"},
            "currency": "UZS",
            "total_amount": 5000,
            "invoice_payload": "n2",
        },
    }


def russian_update(text: str, user_id: int = 556) -> dict:
    """Somebody whose phone is set to Russian — the common case here."""
    update = message_update(text, user_id=user_id)
    update["message"]["from"]["language_code"] = "ru"
    return update
