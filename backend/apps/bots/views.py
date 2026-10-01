"""Bot endpoints.

Connecting, configuring and wiring a bot — everything except what happens when
an update arrives, which belongs to `apps.telegram` and `apps.engine`.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.analytics.services import PAYMENT_HISTORY_LIMIT, bot_payments
from apps.billing.services import check_plan_allows, refusal_reason
from apps.common.exceptions import ApiError
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin
from apps.engine.script import DEFAULT_VARIABLE
from apps.flows.models import Flow
from apps.projects.models import Project
from apps.workspaces.models import Role

from . import managed
from .chats import refresh_chat
from .models import Bot, BotChat, ManagedBotRequest, PaymentConnection
from .serializers import (
    BotChatSerializer,
    BotListSerializer,
    BotSerializer,
    BusinessConnectionSerializer,
    ConnectBotSerializer,
    CreateBotRequestSerializer,
    PaymentConnectionSerializer,
    ScriptLibrarySerializer,
)
from .services import (
    check_webhook,
    connect_bot,
    ensure_webhook_current,
    log_activity,
    reconcile_webhooks,
    register_webhook,
    unregister_webhook,
    webhook_is_current,
)

#: How long a bot's shared Kod source may be.
#:
#: Higher than the 20 000 one block gets, because this one is shared: it is the
#: place four blocks' worth of helpers end up, and a ceiling that forces an
#: author to choose which helper to keep would push them back to pasting the
#: same function into every block. Still a ceiling, because the whole of it is
#: prepended to every script the bot runs — it is paid for on the hot path of
#: every Kod block, not once.
SCRIPT_LIBRARY_LIMIT = 50_000


class BotViewSet(WorkspaceScopedMixin, viewsets.ModelViewSet):
    serializer_class = BotSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = Bot.objects.select_related("project", "connected_by").all()

    def get_serializer_class(self):
        return BotListSerializer if self.action == "list" else BotSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("projectId")
        return queryset.filter(project_id=project_id) if project_id else queryset

    # -- creating a bot, rather than pasting one ---------------------------
    #
    # See `apps.bots.managed` for why this is three round trips and not one:
    # the bot is born on Telegram's side, in a screen only the reader can
    # confirm, and it reaches us through the manager bot's webhook rather than
    # through the response to any of these.

    @action(detail=False, methods=["get"], url_path="managed-config")
    def managed_config(self, request):
        """Whether "Botni yaratish" can be offered, and why not when it cannot.

        It answered three of the four reasons and left out the fourth, so a
        workspace with no seat left was shown an enabled button that spent a
        round trip to come back 402 from `create-request`. An interface
        promising what it cannot deliver is this product's signature failure,
        and the fix is not a friendlier error — it is a button that knows its
        own state before anybody presses it.

        The plan is asked first, and not because it is the likeliest answer.
        It is the only one of the four that also closes the *other* half of
        that screen — a workspace with no room cannot paste a token either —
        so it is the one the reader has to be told about even when the manager
        bot is off, and the only one they can clear themselves. It is also the
        cheapest: `can_manage_bots()` below is a live Bot API call, and nothing
        needs to spend one on a workspace that is full.
        """
        # The server's own sentence, because it names the plan and the cap and
        # a copy written in the frontend could name neither. Empty for the
        # three reasons below, which say the same thing to every workspace and
        # are worded where they are read.
        message = refusal_reason(self.workspace, "bots") or ""
        if message:
            reason = "plan_limit"
        elif not managed.is_configured():
            reason = "not_configured"
        elif not request.user.telegram_id:
            # The update naming the new bot names its creator by Telegram id,
            # and an account that signed in with a password has none to match.
            reason = "telegram_required"
        elif not managed.can_manage_bots():
            reason = "management_off"
        else:
            reason = ""
        return Response(
            {
                "enabled": not reason,
                "reason": reason,
                "message": message,
                "managerUsername": managed.manager_username(),
            }
        )

    @action(detail=False, methods=["post"], url_path="create-request")
    def create_request(self, request):
        """Opens a creation attempt and names the link that completes it.

        Write access is already the permission class's answer: `POST` is not a
        safe method, so an analyst never reaches this line.
        """
        serializer = CreateBotRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = Project.objects.filter(
            workspace=self.workspace, pk=serializer.validated_data["projectId"]
        ).first()
        if project is None:
            raise ApiError("project_not_found", "Loyiha topilmadi", field="projectId", status_code=404)
        # Before the reader is sent to Telegram, not when the bot comes back:
        # a bot created there is created in their own account, and a 402
        # arriving after that leaves somebody holding a real bot this product
        # then declines to store. Also before `can_manage_bots()`, which is a
        # Bot API round trip nothing needs to spend on a refusal.
        check_plan_allows(self.workspace, "bots", field="username")
        if not managed.can_manage_bots():
            raise ApiError(
                "management_off",
                "Boshqaruvchi bot @BotFather'da bot yaratish rejimiga o'tkazilmagan.",
                status_code=400,
            )

        name = serializer.validated_data["name"].strip()
        username = serializer.validated_data["username"]
        attempt = managed.open_request(
            workspace=self.workspace,
            project=project,
            user=request.user,
            name=name,
            username=username,
        )
        return Response(
            {
                "id": attempt.id,
                "url": managed.new_bot_url(username=username, name=name),
                "expiresIn": int(managed.REQUEST_TTL.total_seconds()),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path=r"create-request/(?P<attempt_id>[^/.]+)")
    def create_request_status(self, request, attempt_id=None):
        """Whether the bot has arrived yet. Polled by the screen that opened it."""
        attempt = ManagedBotRequest.objects.filter(
            pk=attempt_id, workspace=self.workspace, requested_by=request.user
        ).first()
        if attempt is None:
            return Response({"status": "expired"})
        if attempt.status == ManagedBotRequest.Status.READY and attempt.bot_id:
            return Response({"status": "ready", "bot": BotSerializer(attempt.bot).data})
        if attempt.status == ManagedBotRequest.Status.FAILED:
            return Response({"status": "failed", "message": attempt.error})
        if attempt.is_expired:
            return Response({"status": "expired"})
        return Response({"status": "pending"})

    def create(self, request, *args, **kwargs):
        serializer = ConnectBotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = Project.objects.filter(
            workspace=self.workspace, pk=serializer.validated_data["projectId"]
        ).first()
        if project is None:
            raise ApiError("project_not_found", "Loyiha topilmadi", field="projectId", status_code=404)

        # Before the write and before the token is verified: a bot the plan
        # will not hold is not worth a Bot API call, and a 402 that arrives
        # after the row exists is a refusal nobody honoured. The other way a
        # bot is born — `managed`, through the manager bot's webhook — is
        # refused in its own two places, because nothing there is a request
        # somebody is waiting on.
        check_plan_allows(self.workspace, "bots", field="token")

        bot = connect_bot(
            workspace=self.workspace,
            project=project,
            token=serializer.validated_data["token"].strip(),
            user=request.user,
            kind=serializer.validated_data["kind"],
        )
        return Response(BotSerializer(bot).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        """Opening a bot's page also repairs a webhook that has gone stale.

        The public address can move under a running install — a tunnel is
        renamed, a deployment changes domain — and Telegram keeps posting to
        where it was told. Nothing else notices, because "no updates arriving"
        looks exactly like "nobody wrote to the bot". This costs one Bot API
        call, and only on the first read after the address actually changed.
        """
        bot = self.get_object()
        if bot.token and not webhook_is_current(bot):
            ensure_webhook_current(bot)
            bot.refresh_from_db()
        return Response(self.get_serializer(bot).data)

    def perform_update(self, serializer):
        """A bot may be moved between projects — but only inside its own tenant.

        `projectId` is writable, and without this check a PATCH naming another
        workspace's project would move the bot (and its flows, contacts and
        numbers) out of the tenant it belongs to.

        **Its flows go with it.** `Flow` carries a `project` of its own beside
        its `bot`, so a move used to leave every flow behind in the project the
        bot came from: nothing breaks in the runtime, which finds flows by bot,
        but the project that no longer owns the bot goes on listing its flows
        and the one that does lists none. This was reachable from no screen for
        as long as it was wrong, which is how it stayed wrong.
        """
        project_id = serializer.validated_data.get("project_id")
        if project_id and not Project.objects.filter(workspace=self.workspace, pk=project_id).exists():
            raise ApiError("project_not_found", "Loyiha topilmadi", field="projectId", status_code=404)
        moved_to = project_id if project_id and project_id != serializer.instance.project_id else ""

        # Read before the save, because afterwards there is nothing left to
        # compare against. "Who stopped the bot, and when" is the first thing
        # asked when one is found stopped, and `BotActivity` is where every
        # other answer of that kind already is — the panel prints it on the
        # same screen as the switch.
        was_paused = serializer.instance.is_paused
        bot = serializer.save()
        if moved_to:
            Flow.objects.filter(bot=bot).update(project_id=moved_to)
        if "is_paused" in serializer.validated_data and bot.is_paused != was_paused:
            log_activity(
                bot,
                f"Bot to'xtatildi ({self.request.user.email})" if bot.is_paused
                else f"Bot qayta ishga tushirildi ({self.request.user.email})",
                "pause" if bot.is_paused else "play",
            )

    def perform_destroy(self, instance: Bot):
        unregister_webhook(instance)
        instance.delete()

    @action(detail=True, methods=["post"], url_path="reveal-token")
    def reveal_token(self, request, pk=None):
        """Hands back the real token.

        Deliberately its own endpoint, restricted to the two roles that could
        re-create the bot anyway — a token in a list response is a token in
        every browser cache and server log that ever saw that list.
        """
        bot = self.get_object()
        if self.membership.role not in {Role.OWNER, Role.ADMIN}:
            raise PermissionDenied("Tokenni faqat egasi yoki administrator ko'ra oladi")
        log_activity(bot, f"Token ko'rsatildi ({request.user.email})", "eye-slash")
        return Response({"token": bot.token})

    @action(detail=True, methods=["post"], url_path="rotate-token")
    def rotate_token(self, request, pk=None):
        """Replaces the stored token with a new one from @BotFather and re-registers the webhook."""
        bot = self.get_object()
        token = (request.data.get("token") or "").strip()
        if not token:
            raise ApiError("token_required", "Yangi token kiriting", field="token")
        bot.token = token
        bot.save(update_fields=["token"])
        register_webhook(bot)
        log_activity(bot, "Token almashtirildi", "key")
        return Response(BotSerializer(bot).data)

    @action(detail=True, methods=["get", "post"])
    def webhook(self, request, pk=None):
        """GET reads Telegram's own view of the webhook; POST re-registers it.

        The GET also dials the address, because this is the one call a person
        makes while waiting for an answer — and "Telegram has the right URL on
        file" is not the same claim as "the bot is receiving messages".
        """
        bot = self.get_object()
        if request.method == "GET":
            return Response(check_webhook(bot, probe=True))
        ok = register_webhook(bot)
        return Response({"ok": ok, "url": bot.webhook_url, "error": bot.webhook_error})

    @action(detail=False, methods=["post"], url_path="reconcile-webhooks")
    def reconcile_webhooks_view(self, request):
        """Re-points every bot in this workspace at wherever the backend is now.

        The one button for "the address moved": a redeployment, a new tunnel,
        or somebody having set a webhook by hand. It is also what runs on boot,
        so pressing it should normally report that nothing needed changing.
        """
        results = reconcile_webhooks(workspace=self.workspace)
        return Response({"checked": len(results), "changed": sum(1 for row in results if row["changed"]), "bots": results})

    @action(detail=True, methods=["post"], url_path="disconnect-webhook")
    def disconnect_webhook(self, request, pk=None):
        return Response({"ok": unregister_webhook(self.get_object())})

    @action(detail=True, methods=["get"], url_path="business-connections")
    def business_connections(self, request, pk=None):
        """The Business accounts this bot is attached to, and what is wrong.

        `select_related("bot")` because every row's `problems` reads the bot's
        own paused flag and module list — the same argument as `chats` above,
        one query rather than one per account.
        """
        rows = self.get_object().business_connections.select_related("bot").all()
        return Response(BusinessConnectionSerializer(rows, many=True).data)

    # -- the groups and channels this bot is in ---------------------------
    #
    # Kept current by the webhook (`engine.dispatch` → `bots.chats`), so these
    # three are a screen's controls rather than the way the registry is filled:
    # a bot added to a group appears here without anybody pressing anything.

    @action(detail=True, methods=["get"], url_path="chats")
    def chats(self, request, pk=None):
        """Every group and channel this bot has been in, however that ended.

        Readable by any member, an analyst included: this is the answer to
        "which rooms is our bot in and what can it do there", and a rule that
        hides it from the people asked to check it is the wrong rule.

        A chat the bot was removed from stays in the list, at the bottom (see
        `BotChat.Meta.ordering`). Dropping it would make «bot guruhdan
        chiqarilgan» indistinguishable from «bot u guruhda hech qachon
        bo'lmagan», and the first is the thing somebody is looking for.
        """
        rows = self.get_object().chats.select_related("bot").all()
        return Response(BotChatSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"], url_path=r"chats/(?P<chat_id>-?\d+)/refresh")
    def refresh_chat_view(self, request, pk=None, chat_id: str = ""):
        """Asks Telegram about one chat, now.

        The webhook keeps the bot's *standing* current; nothing announces a
        group being renamed, made public, or joined by two hundred people. This
        is that half, and it is a button rather than a schedule because a
        workspace with fifty chats would otherwise spend a hundred and fifty Bot
        API calls an hour keeping numbers nobody is looking at fresh.

        A refusal is not a failed request: the row keeps everything it had and
        says what went wrong, which reaches the screen as a `stale` finding on
        the chat itself. See `chats.refresh_chat`.
        """
        chat = self._chat(chat_id)
        return Response(BotChatSerializer(refresh_chat(chat)).data)

    @action(detail=True, methods=["delete"], url_path=r"chats/(?P<chat_id>-?\d+)")
    def chat(self, request, pk=None, chat_id: str = ""):
        """Forgets one chat.

        Only ever a tidy-up: this removes a row, not the bot from the group —
        no Bot API method lets a bot remove itself, and pretending otherwise
        would leave somebody believing they had left a room they are still in.
        If the bot is still there, the next `my_chat_member` about it puts the
        row back, which is the honest outcome.
        """
        self._chat(chat_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _chat(self, chat_id: str) -> BotChat:
        """One of this bot's chats, or a 404.

        Through `get_object()`, so the tenant check is the same one every other
        route on this viewset makes: another workspace's bot is not found, and a
        chat id that belongs to a different bot of the same workspace is not
        found either.
        """
        chat = self.get_object().chats.select_related("bot").filter(chat_id=chat_id).first()
        if chat is None:
            raise ApiError("chat_not_found", "Bu chat ro'yxatda yo'q", status_code=404)
        return chat

    @action(detail=True, methods=["get", "post"], url_path="payments")
    def payments(self, request, pk=None):
        """The bot's payment providers. A token that arrives here never comes back out."""
        bot = self.get_object()
        if request.method == "GET":
            return Response(PaymentConnectionSerializer(bot.payment_connections.all(), many=True).data)

        serializer = PaymentConnectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        connection, _ = PaymentConnection.objects.update_or_create(
            bot=bot,
            provider_id=data["provider_id"],
            defaults={
                "token": data.get("token", ""),
                "mode": data.get("mode", ""),
                "last_checked_at": timezone.now(),
            },
        )
        log_activity(bot, f"To'lov provayderi ulandi: {connection.provider_id}", "credit-card")
        return Response(PaymentConnectionSerializer(connection).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete", "post"], url_path=r"payments/(?P<provider_id>[^/.]+)")
    def payment(self, request, pk=None, provider_id: str = ""):
        """One provider: DELETE disconnects it, POST re-checks the stored token.

        "Re-check" is honest about what it can do without leaving the machine:
        a provider token is verified by Telegram only when an invoice is sent,
        so what is recorded here is that somebody asked and when.
        """
        bot = self.get_object()
        connection = bot.payment_connections.filter(provider_id=provider_id).first()
        if connection is None:
            raise ApiError("provider_not_found", "Bu provayder ulanmagan", status_code=404)

        if request.method == "DELETE":
            connection.delete()
            log_activity(bot, f"To'lov provayderi uzildi: {provider_id}", "credit-card")
            return Response(status=status.HTTP_204_NO_CONTENT)

        connection.last_checked_at = timezone.now()
        connection.error = ""
        connection.status, connection.status_tone = ("Ulangan", "success")
        connection.save(update_fields=["last_checked_at", "error", "status", "status_tone"])
        return Response(PaymentConnectionSerializer(connection).data)

    @action(detail=True, methods=["get"], url_path="payment-history")
    def payment_history(self, request, pk=None):
        """The money this bot has actually taken, newest first.

        A bot-scoped route rather than `/api/analytics/…?botId=`, because the
        bot is what the screen is about and `get_object()` is what makes an
        unknown or another tenant's id a 404 here — a query parameter would
        have answered an empty list, which reads as "nobody has paid" rather
        than "that is not your bot".

        Its own path rather than a `payments/` sub-route: the router registers
        `payments/<provider_id>` first, so `payments/history` would resolve to
        the provider endpoint and answer 405 to a GET.
        """
        bot = self.get_object()
        requested = request.query_params.get("limit") or ""
        limit = int(requested) if requested.isdigit() else PAYMENT_HISTORY_LIMIT
        return Response(bot_payments(self.workspace, bot.id, limit=limit))

    # -- the Kod panel -----------------------------------------------------
    #
    # Two endpoints for one screen: the source every block in this bot shares,
    # and every block that will be running it.

    @action(detail=True, methods=["get", "put"], url_path="script-library")
    def script_library(self, request, pk=None):
        """The JavaScript put above every Kod block this bot runs.

        Write access is already the permission class's answer: `PUT` is not a
        safe method, so an analyst reading the panel sees the library and never
        reaches the line that saves it.

        `source` has to be sent, and sent as a string. A missing key read as ""
        is how an autosave with a bug in it erases work nobody asked it to
        touch — the same reason `GraphSerializer` writes a flow's name only
        when the name was actually in the payload.
        """
        bot = self.get_object()
        if request.method == "GET":
            return Response(ScriptLibrarySerializer(bot).data)

        source = request.data.get("source")
        if not isinstance(source, str):
            raise ApiError("source_required", "Kod matni yuborilmadi", field="source")
        if len(source) > SCRIPT_LIBRARY_LIMIT:
            raise ApiError(
                "script_library_too_long",
                f"Kutubxona juda uzun — {SCRIPT_LIBRARY_LIMIT} belgidan oshmasin",
                field="source",
            )

        # A file that does not parse is not stored. Every Kod block in this bot
        # is composed with the library above it, so a broken one takes all of
        # them down at once — silently, since nothing runs until a customer
        # writes in. Refused here rather than reported by a button somebody has
        # to remember to press.
        from apps.engine.script import check_syntax

        broken = check_syntax(source)
        if broken:
            raise ApiError("script_syntax_error", f"Kodda xato: {broken}", field="source")

        bot.script_library = source
        bot.script_library_updated_at = timezone.now()
        bot.save(update_fields=["script_library", "script_library_updated_at", "updated_at"])
        return Response(ScriptLibrarySerializer(bot).data)

    @action(detail=True, methods=["get"])
    def scripts(self, request, pk=None):
        """Every Kod block in this bot, wherever it was drawn.

        Code inside a canvas is code nobody reviews: a block is a card among
        forty others on a flow somebody opened once, and "which of our bots run
        JavaScript, and what does it do" has until now been a question that
        could only be answered by opening every flow. This is that question as
        one request.

        Readable by any member, including an analyst. It is the bot's own
        source and it reaches no customer — and a rule that hides code from the
        people asked to check it is the wrong rule for the thing being checked.

        The graph is read out of `Flow.nodes` rather than from any index. There
        is none: `FlowTrigger` denormalises what the runtime *matches* on, and
        building a second derived table for a panel that is opened by hand
        would be a table that can disagree with the canvas.
        """
        bot = self.get_object()
        flows = (
            Flow.objects.filter(bot=bot)
            .only("id", "name", "enabled", "nodes")
            # Switched on first, because a script that is running is the one
            # worth reading; `id` only decides between two flows named alike,
            # so the order is stable rather than whatever the database returns.
            .order_by("-enabled", "name", "id")
        )

        blocks = [row for flow in flows for row in _script_blocks(flow)]
        return Response({"library": ScriptLibrarySerializer(bot).data, "blocks": blocks})


def _script_blocks(flow: Flow) -> list[dict]:
    """The Kod blocks of one flow, in an order that does not move between reads.

    By node id, which is the only thing a block is guaranteed to have: a title
    is the author's and two of them can be «Kod», and the position on the
    canvas moves whenever somebody tidies it up.
    """
    nodes = [node for node in (flow.nodes or []) if isinstance(node, dict) and node.get("type") == "script"]
    rows = []
    for node in sorted(nodes, key=lambda node: str(node.get("id") or "")):
        config = node.get("script") if isinstance(node.get("script"), dict) else {}
        source = str(config.get("source") or "")
        rows.append(
            {
                "flowId": flow.id,
                "flowName": flow.name,
                "flowEnabled": flow.enabled,
                "nodeId": str(node.get("id") or ""),
                "title": str(node.get("title") or ""),
                # What the runtime will actually write, not what the author
                # left blank — `runner._handle_script` falls back to the same
                # name, and a panel showing nothing here sends somebody looking
                # for a variable that is already there.
                "variable": str(config.get("variable") or "").strip() or DEFAULT_VARIABLE,
                "lines": len(source.splitlines()),
                "source": source,
            }
        )
    return rows
