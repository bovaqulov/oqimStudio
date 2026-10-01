"""Groups and channels: the registry the webhook keeps, and the flows that run there.

Two halves of one subject. `my_chat_member` is the only thing Telegram ever
sends about the bot's own standing in a room — added, promoted, demoted, thrown
out — and until it was wired up nothing anywhere recorded which chats a bot was
even in. The rest of the file walks a group flow and a channel flow end to end,
because a module is worth un-hiding only if the blocks in its palette actually
answer.
"""

from apps.bots.models import BotChat
from apps.inbox.models import Message

from .base import *  # noqa: F401,F403
from .base import _update_ids  # a star import skips it, and every update needs one


def membership_update(
    *,
    new_status: str = "member",
    old_status: str = "left",
    chat_id: int = -1001,
    chat_type: str = "supergroup",
    title: str = "Sunrise guruh",
    rights: dict | None = None,
    date: int = 1_700_000_000,
) -> dict:
    """`my_chat_member` as Telegram sends it about the bot itself."""
    return {
        "update_id": next(_update_ids),
        "my_chat_member": {
            "chat": {"id": chat_id, "type": chat_type, "title": title},
            "from": {"id": 777, "first_name": "Aziza"},
            "date": date,
            "old_chat_member": {"status": old_status, "user": {"id": 1, "is_bot": True}},
            "new_chat_member": {"status": new_status, "user": {"id": 1, "is_bot": True}, **(rights or {})},
        },
    }


def block_update(user_id: int = 555, status: str = "kicked") -> dict:
    """The same update shape in a private chat, which means something else entirely."""
    return {
        "update_id": next(_update_ids),
        "my_chat_member": {
            "chat": {"id": user_id, "type": "private"},
            "from": {"id": user_id, "first_name": "Dilnoza"},
            "date": 1_700_000_000,
            "old_chat_member": {"status": "member" if status == "kicked" else "kicked"},
            "new_chat_member": {"status": status},
        },
    }


def join_update(chat_id: int = -1001, user_id: int = 555) -> dict:
    """Somebody joining a group — Telegram delivers it as a service message."""
    return {
        "update_id": next(_update_ids),
        "message": {
            "message_id": 20,
            "chat": {"id": chat_id, "type": "supergroup", "title": "Sunrise guruh"},
            "from": {"id": user_id, "first_name": "Dilnoza", "username": "dilnoza"},
            "new_chat_members": [{"id": user_id, "first_name": "Dilnoza"}],
        },
    }


def channel_post_update(chat_id: int = -1002, text: str = "Yangi post") -> dict:
    """A post in a channel. There is no `from` at all — nobody to make a contact of."""
    return {
        "update_id": next(_update_ids),
        "channel_post": {
            "message_id": 30,
            "chat": {"id": chat_id, "type": "channel", "title": "Sunrise kanal"},
            "text": text,
        },
    }


class ChatRegistryTests(EngineTestCase):
    """What the panel knows about the rooms a bot is in, and how it learned it."""

    def test_being_added_to_a_group_puts_it_on_the_list(self):
        result = dispatch(self.bot, membership_update())

        self.assertEqual(result["reason"], "membership_added")
        chat = BotChat.objects.get()
        self.assertEqual(chat.chat_id, -1001)
        self.assertEqual(chat.title, "Sunrise guruh")
        self.assertEqual(chat.type, "supergroup")
        self.assertEqual(chat.status, "member")
        self.assertTrue(chat.is_member)
        # The update's own `date`, not the moment the webhook happened to be
        # processed — a re-delivery an hour later must not move it.
        self.assertEqual(chat.added_at.timestamp(), 1_700_000_000)
        self.assertTrue(self.bot.activity.filter(text__contains="qo'shildi").exists())

    def test_being_promoted_records_what_telegram_granted(self):
        dispatch(self.bot, membership_update())
        dispatch(
            self.bot,
            membership_update(
                old_status="member",
                new_status="administrator",
                rights={"can_delete_messages": True, "can_invite_users": True, "can_change_info": False},
            ),
        )

        chat = BotChat.objects.get()
        self.assertEqual(chat.status, "administrator")
        self.assertTrue(chat.is_administrator)
        self.assertTrue(chat.can("can_delete_messages"))
        self.assertFalse(chat.can("can_change_info"))

    def test_an_owner_has_every_right_even_though_telegram_names_none(self):
        # `ChatMemberOwner` carries no `can_*` fields: the answer is "all of
        # them". Stored literally, the one member who can do anything would
        # read as able to do nothing.
        dispatch(self.bot, membership_update(old_status="administrator", new_status="creator"))

        chat = BotChat.objects.get()
        self.assertTrue(chat.can("can_post_messages"))
        self.assertTrue(chat.can("can_delete_messages"))

    def test_being_demoted_takes_the_rights_back(self):
        dispatch(self.bot, membership_update(new_status="administrator", rights={"can_delete_messages": True}))
        result = dispatch(self.bot, membership_update(old_status="administrator", new_status="member"))

        self.assertEqual(result["reason"], "membership_demoted")
        chat = BotChat.objects.get()
        self.assertFalse(chat.is_administrator)
        self.assertFalse(chat.can("can_delete_messages"))

    def test_being_removed_leaves_the_row_and_says_so(self):
        dispatch(self.bot, membership_update())
        result = dispatch(self.bot, membership_update(old_status="member", new_status="kicked"))

        self.assertEqual(result["reason"], "membership_removed")
        chat = BotChat.objects.get()
        # Kept, not deleted: "the bot was thrown out of this group" and "the bot
        # was never in that group" are different answers, and the first is the
        # one somebody came to this screen for.
        self.assertFalse(chat.is_member)
        self.assertIsNotNone(chat.left_at)

    def test_being_added_back_clears_the_departure(self):
        dispatch(self.bot, membership_update())
        dispatch(self.bot, membership_update(old_status="member", new_status="kicked"))
        dispatch(self.bot, membership_update(old_status="kicked", new_status="administrator"))

        chat = BotChat.objects.get()
        self.assertTrue(chat.is_member)
        self.assertIsNone(chat.left_at)

    def test_the_same_chat_is_one_row_however_often_it_changes(self):
        for status in ["member", "administrator", "member", "kicked"]:
            dispatch(self.bot, membership_update(new_status=status))

        self.assertEqual(BotChat.objects.count(), 1)

    def test_two_bots_in_one_group_each_have_their_own_standing(self):
        other = Bot.objects.create(
            id="b2", workspace=self.workspace, project=self.project, handle="@b2", token="t2"
        )
        dispatch(self.bot, membership_update(new_status="administrator"))
        dispatch(other, membership_update(new_status="member"))

        self.assertEqual(BotChat.objects.get(bot=self.bot).status, "administrator")
        self.assertEqual(BotChat.objects.get(bot=other).status, "member")

    def test_a_channel_is_recorded_as_a_channel(self):
        dispatch(
            self.bot,
            membership_update(chat_id=-1002, chat_type="channel", title="Sunrise kanal", new_status="administrator"),
        )

        chat = BotChat.objects.get()
        self.assertEqual(chat.type, "channel")
        self.assertEqual(chat.module_key, "channels")

    def test_a_membership_update_starts_nothing_and_is_not_filed_as_a_message(self):
        self.bot.enabled_modules = ["dms", "groups"]
        self.bot.save(update_fields=["enabled_modules"])
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["any"]}},
                {"id": "m1", "type": "message", "text": "salom"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
        )

        dispatch(self.bot, membership_update())

        # Nobody said anything and nobody is waiting for an answer: a status
        # change is not a line in Suhbatlar and not a conversation to start.
        self.assertEqual(FlowRun.objects.count(), 0)
        self.assertEqual(Message.objects.count(), 0)
        self.assertEqual(Contact.objects.count(), 0)

    def test_a_status_nobody_here_knows_is_left_unwritten(self):
        # `ChatMember.status` is an enumeration only Telegram may extend, and
        # mapping an unknown one onto the nearest is how a screen ends up
        # saying the bot is fine when it is not.
        result = dispatch(self.bot, membership_update(new_status="poltergeist"))

        self.assertEqual(result["reason"], "membership_unknown_status")
        self.assertEqual(BotChat.objects.count(), 0)

    def test_a_malformed_update_does_not_reach_the_webhook_as_a_500(self):
        # Telegram re-delivers anything that errors, forever. Nothing about the
        # registry may raise into the update path.
        broken = {"update_id": next(_update_ids), "my_chat_member": {"chat": {"id": -1, "type": "supergroup"}}}

        self.assertEqual(dispatch(self.bot, broken)["reason"], "membership_unknown_status")


class BlockedContactStillWorksTests(EngineTestCase):
    """The other half of `my_chat_member`, which this change had to leave alone.

    In a private chat the update is about the customer, not about the bot: a
    status of "kicked" is somebody blocking it. Pinned here as well as in
    `test_dispatch.py` because both readings now live in one branch, and the
    group case is the one that arrived second.
    """

    def test_a_private_chat_kick_is_still_a_block(self):
        Contact.objects.create(
            workspace=self.workspace, bot=self.bot, telegram_user_id=555, chat_id=555, first_name="Dilnoza"
        )

        dispatch(self.bot, block_update(status="kicked"))

        self.assertTrue(Contact.objects.get().is_blocked)
        self.assertEqual(BotChat.objects.count(), 0, "a private chat is not a room the bot is in")

    def test_coming_back_unblocks(self):
        Contact.objects.create(
            workspace=self.workspace,
            bot=self.bot,
            telegram_user_id=555,
            chat_id=555,
            first_name="Dilnoza",
            is_blocked=True,
        )

        dispatch(self.bot, block_update(status="member"))

        self.assertFalse(Contact.objects.get().is_blocked)


class GroupFlowTests(EngineTestCase):
    """A groups flow, walked the way an update walks it."""

    def setUp(self) -> None:
        super().setUp()
        self.bot.enabled_modules = ["dms", "groups"]
        self.bot.save(update_fields=["enabled_modules"])

    def test_a_new_member_is_greeted_in_the_group(self):
        self.make_flow(
            [
                {"id": "j1", "type": "groupjoin", "title": "Yangi a'zo"},
                {"id": "m1", "type": "message", "text": "Xush kelibsiz, {{user.first_name}}!"},
            ],
            [{"id": "e1", "from": "j1", "port": "out", "to": "m1"}],
            module_key="groups",
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, join_update())["runId"])
        sent = run.steps.filter(actor="bot").get()
        self.assertEqual(sent.text, "Xush kelibsiz, Dilnoza!")
        # Into the group, not into the joiner's private chat — which the bot
        # has no right to open.
        self.assertEqual(sent.payload["payload"]["chat_id"], -1001)

    def test_a_leaving_member_answers_its_own_block(self):
        self.make_flow(
            [
                {"id": "l1", "type": "groupleave", "title": "Chiqdi"},
                {"id": "m1", "type": "message", "text": "Xayr!"},
            ],
            [{"id": "e1", "from": "l1", "port": "out", "to": "m1"}],
            module_key="groups",
        )

        update = join_update()
        del update["message"]["new_chat_members"]
        update["message"]["left_chat_member"] = {"id": 555, "first_name": "Dilnoza"}

        run = FlowRun.objects.get(pk=dispatch(self.bot, update)["runId"])
        self.assertEqual(run.steps.filter(actor="bot").get().text, "Xayr!")

    def test_a_group_message_reaches_a_keyword_flow(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["keyword"], "keywords": "narx"}},
                {"id": "m1", "type": "message", "text": "Narxlar ro'yxati"},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            module_key="groups",
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("narx qancha?", chat_type="supergroup"))["runId"])
        self.assertEqual(run.steps.filter(actor="bot").get().text, "Narxlar ro'yxati")

    def test_the_module_being_off_is_the_whole_difference(self):
        self.bot.enabled_modules = ["dms"]
        self.bot.save(update_fields=["enabled_modules"])
        self.make_flow(
            [
                {"id": "j1", "type": "groupjoin"},
                {"id": "m1", "type": "message", "text": "Xush kelibsiz!"},
            ],
            [{"id": "e1", "from": "j1", "port": "out", "to": "m1"}],
            module_key="groups",
        )

        self.assertEqual(dispatch(self.bot, join_update())["reason"], "no_trigger")


class ChannelFlowTests(EngineTestCase):
    """A channels flow. Nobody sent the update, which is the interesting part."""

    def setUp(self) -> None:
        super().setUp()
        self.bot.enabled_modules = ["dms", "channels"]
        self.bot.save(update_fields=["enabled_modules"])

    def test_a_channel_post_runs_the_flow_and_answers_in_the_channel(self):
        self.make_flow(
            [
                {"id": "p1", "type": "channelpost", "title": "Yangi post"},
                {"id": "m1", "type": "message", "text": "Post qabul qilindi: {{message.text}}"},
            ],
            [{"id": "e1", "from": "p1", "port": "out", "to": "m1"}],
            module_key="channels",
        )

        run = FlowRun.objects.get(pk=dispatch(self.bot, channel_post_update())["runId"])
        sent = run.steps.filter(actor="bot").get()
        self.assertEqual(sent.text, "Post qabul qilindi: Yangi post")
        self.assertEqual(sent.payload["payload"]["chat_id"], -1002)
        # A channel post has no `from`: there is nobody behind it to make a
        # contact of, and the run has to walk anyway.
        self.assertIsNone(run.contact_id)
        self.assertEqual(Contact.objects.count(), 0)

    def test_a_join_request_on_a_channel_belongs_to_the_channels_module(self):
        self.make_flow(
            [
                {"id": "j1", "type": "joinrequest", "title": "So'rov"},
                {"id": "m1", "type": "message", "text": "So'rovingiz ko'rib chiqilmoqda"},
            ],
            [{"id": "e1", "from": "j1", "port": "out", "to": "m1"}],
            module_key="channels",
        )

        result = dispatch(
            self.bot,
            {
                "update_id": next(_update_ids),
                "chat_join_request": {
                    "chat": {"id": -1002, "type": "channel", "title": "Sunrise kanal"},
                    "from": {"id": 555, "first_name": "Dilnoza"},
                    "user_chat_id": 555,
                    "date": 0,
                },
            },
        )

        run = FlowRun.objects.get(pk=result["runId"])
        # The request arrives on the channel, which nobody can write into on the
        # applicant's behalf — Telegram hands over `user_chat_id` for this.
        self.assertEqual(run.steps.filter(actor="bot").get().payload["payload"]["chat_id"], 555)
