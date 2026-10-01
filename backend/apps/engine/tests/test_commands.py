"""What a flow's script does, and the promise that it does none of it early.

`test_hooks.py` asks when a hook runs and what the conversation carries
afterwards. This asks the question one layer down: a hook can now *act*, and
the whole feature rests on a single rule — a script calling `bot.send()` sends
nothing. It appends to a list, and the list is executed once the script has
returned without throwing.

Almost every test below is that rule seen from a different angle. Nothing
reaches Telegram while the script is still running, so a script that dies
halfway leaves no half-done conversation; a scope nobody granted stops the
script before the list is built; every ceiling is reached inside the sandbox
where reaching it costs nothing; and the one thing that cannot be deferred —
`await http.get(…)`, `await store.incr(…)` — reaches the host by halting the
script and running it again, which is only safe because an unfinished script
has done nothing.

The tests that really run JavaScript carry `SCRIPTS`, the same skip
`test_hooks.py` and `test_script.py` use: a deployment without Node is a
supported one. The rest are about the runtime's half — what it does with a list
somebody hands it — and stand in for the sandbox on purpose, because a list is
the thing under test and building one by hand is more honest than compiling one.
"""

from unittest import mock, skipUnless

from django.core.cache import cache
from django.test import override_settings

from apps.engine import commands
from apps.engine.script import ScriptResult, is_available
from apps.telegram.client import TelegramError

from .base import *  # noqa: F401,F403

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

#: What a successful outbound request is answered with, so a test can drive the
#: replay loop without a socket. The shape is `commands._http`'s own.
OK_RESPONSE = {"ok": True, "value": {"status": 200, "ok": True, "body": {"narx": 5}, "headers": {}}}


def script(scopes: str, body: str, hook: str = "onFlowStart") -> str:
    """One hook, with the grant that lets it do anything at all.

    The grant is a directive comment in the file rather than a column beside
    it, and writing every fixture through this helper is how that stays
    visible: a script with no `@ruxsat` line is a script that may compute and
    nothing else, which is the default the whole scope design turns on.
    """
    return f"// @ruxsat: {scopes}\nasync function {hook}(ctx) {{\n{body}\n}}"


class CommandTestCase(EngineTestCase):
    """One bot, one greeting flow, and a Telegram client that records."""

    def setUp(self) -> None:
        super().setUp()
        # `store` lives in the Django cache, which is per-process here and
        # shared between tests in the same process. A counter left behind by
        # one test is the next test's queue number.
        cache.clear()

    def make_greeting(self, **extra):
        """Trigger → one message → the end of the graph, plus a block nothing
        routes into. The unwired one is where `flow.goto` has to be able to
        send the conversation, and it is unwired precisely so that walking to it
        can only have been the script's doing."""
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "salom"}},
                {"id": "m1", "type": "message", "text": extra.pop("says", "Salom!")},
                {"id": "m2", "type": "message", "text": "Boshqa yo'l."},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            **extra,
        )

    def make_survey(self, **extra):
        """The same with a button in the middle — a run that parks and resumes,
        which is the only way to reach `onUserMessage`."""
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "anketa"}},
                {"id": "m1", "type": "message", "text": "Nechta?", "buttons": [{"id": "b1", "label": "Ikkita"}]},
                {"id": "m2", "type": "message", "text": "Rahmat!"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
            ],
            **extra,
        )

    def greet(self) -> FlowRun:
        return FlowRun.objects.get(pk=dispatch(self.bot, message_update("/salom"))["runId"])

    def said(self, run: FlowRun) -> list[str]:
        return [step.text for step in run.steps.filter(actor="bot")]

    def faults(self, run: FlowRun) -> list[str]:
        """Every line the runtime wrote on its own behalf about a script."""
        return [
            step.text
            for step in run.steps.filter(actor="system")
            if step.payload.get("kind") in {"hook", "command", "commands"}
        ]

    def telegram(self):
        """A client whose every call is recorded. `_client` and not the socket,
        because what is being counted is calls the runtime chose to make."""
        return mock.patch("apps.engine.runner._client")


class DeferredTests(CommandTestCase):
    """The rule the whole stage turns on: nothing happens until the script is done."""

    @SCRIPTS
    def test_nothing_reaches_telegram_while_the_script_is_still_running(self):
        """The strongest form of the promise, and the only one worth asserting:
        not "the messages arrived" but "they had not arrived yet". The script
        sends, then awaits something the host has to fetch — which is the one
        moment the runtime is demonstrably in the middle of a script — and the
        Bot API has been asked for nothing."""
        self.make_greeting(
            script=script(
                "bot, http",
                "bot.send('Bir'); await http.get('https://narx.uz/x'); bot.send('Ikki');",
            )
        )
        during = {}

        def answer(effect):
            during["calls"] = client.return_value.call.call_count
            return OK_RESPONSE

        with self.telegram() as client:
            client.return_value.call.return_value = {"message_id": 7}
            with mock.patch("apps.engine.commands._http", side_effect=answer):
                run = self.greet()

        self.assertEqual(during["calls"], 0, "the script was mid-run and nothing had been sent")
        self.assertEqual(self.said(run)[:2], ["Bir", "Ikki"], "and both went out once it finished")

    @SCRIPTS
    def test_a_script_that_throws_after_sending_sends_nothing(self):
        """Three sends and a `throw` is not three quarters of a conversation.
        The list dies with the process, which is what makes a half-written
        script safe to run against a real customer."""
        self.make_greeting(
            script=script("bot", "bot.send('Bir'); bot.send('Ikki'); throw new Error('narx topilmadi');")
        )

        with self.telegram() as client:
            client.return_value.call.return_value = {"message_id": 7}
            with self.assertLogs("apps.engine.runner", "WARNING"):
                run = self.greet()

        self.assertEqual([call.args[0] for call in client.return_value.call.call_args_list], ["sendMessage"])
        self.assertEqual(self.said(run), ["Salom!"], "the block's own message, and nothing the script asked for")
        self.assertEqual(run.status, FlowRun.Status.DONE, "and the conversation ended the way it would have")
        # The author's own words, which is what says the two sends were reached
        # and *then* discarded. Without it this test passes for the wrong
        # reason: a script that cannot call `bot.send` at all also sends
        # nothing, and would look identical from the Bot API's side.
        self.assertTrue(any("narx topilmadi" in line for line in self.faults(run)), self.faults(run))

    @SCRIPTS
    def test_what_it_sent_is_in_the_trace(self):
        """A command is journalled where the author already looks. Both the
        message itself and the line saying how many things the list held."""
        self.make_greeting(script=script("bot", "bot.send('Savatingizda 3 ta mahsulot.');"))

        run = self.greet()

        self.assertIn("Savatingizda 3 ta mahsulot.", self.said(run))
        self.assertEqual([step.payload["ops"] for step in run.steps.filter(payload__kind="commands")], [["bot.send"]])

    @SCRIPTS
    def test_a_variable_the_same_script_computed_is_already_readable(self):
        """Why the order inside `_fire` is fixed: what the hook returned is
        merged before the list is applied, so a script that works out a total
        and then sends it sends the total and not the placeholder."""
        self.make_greeting(script=script("bot", "bot.send('Jami {{jami}} so\\'m'); return { jami: 12000 };"))

        run = self.greet()

        self.assertIn("Jami 12000 so'm", self.said(run))


class FlowDirectionTests(CommandTestCase):
    """`flow.*` — one per run, and the walk has to honour it."""

    @SCRIPTS
    def test_goto_moves_the_walk(self):
        """`m2` is wired to nothing. Reaching it can only have been the script."""
        self.make_greeting(script=script("flow", "flow.goto('m2');"))

        run = self.greet()

        self.assertEqual(self.said(run), ["Boshqa yo'l."])
        self.assertEqual(run.status, FlowRun.Status.DONE)

    @SCRIPTS
    def test_a_second_flow_call_fails_with_one_sentence(self):
        """Two of them is not a script asking for two things — it is an author
        who believes the first one left the function. Nothing here takes effect
        immediately, so the second would silently win."""
        self.make_greeting(script=script("flow", "flow.goto('m2'); flow.goto('m1');"))

        with self.assertLogs("apps.engine.runner", "WARNING"):
            run = self.greet()

        self.assertTrue(
            any("Oqim yo'nalishi allaqachon belgilangan (flow.goto)" in line for line in self.faults(run)),
            self.faults(run),
        )
        self.assertEqual(self.said(run), ["Salom!"], "and neither jump happened")

    @SCRIPTS
    def test_goto_out_of_onusermessage_overrules_the_button(self):
        """The tap says `m2`; the script says `m1`. The one written most
        recently wins, and the reply is still recorded as a reply."""
        self.make_survey(script=script("flow", "flow.goto('m1');", hook="onUserMessage"))
        dispatch(self.bot, message_update("/anketa"))

        dispatch(self.bot, callback_update("btn:b1"))

        run = FlowRun.objects.get(flow__name="Oqim")
        self.assertEqual(self.said(run), ["Nechta?", "Nechta?"], "back to the block it was on, not on to «Rahmat!»")
        self.assertEqual([step.text for step in run.steps.filter(actor="user")], ["Ikkita"])

    @SCRIPTS
    def test_stop_leaves_the_conversation_open(self):
        """The one ending that is not one: the blocks after it do not run and
        nothing announces an end, so the run parks where it stands."""
        self.make_greeting(script=script("flow", "flow.stop();"))

        run = self.greet()

        self.assertEqual(self.said(run), [], "no block ran")
        self.assertEqual(run.status, FlowRun.Status.WAITING, "and the run is not finished")

    @SCRIPTS
    def test_end_finishes_the_run(self):
        self.make_greeting(script=script("flow", "flow.end();"))

        run = self.greet()

        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(self.said(run), [])

    def test_a_goto_naming_a_block_that_is_not_there_walks_on(self):
        """A block id that has gone — renamed, deleted — is not a reason to drop
        the conversation. Said out loud, and the flow runs as drawn."""
        self.make_greeting(script="function onFlowStart(ctx) {}")

        with mock.patch(
            "apps.engine.hooks.call",
            return_value=mock.Mock(ok=True, written={}, logs=(), commands=({"op": "flow.goto", "blockId": "yo'q"},)),
        ):
            # The flow needs *a* script or `_fire` leaves on its first line, and
            # what it says does not matter — `hooks.call` is standing in for the
            # sandbox, because the list is what is under test and not the
            # compiler that produced it.
            run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/salom"))["runId"])

        self.assertEqual(self.said(run), ["Salom!"])
        self.assertTrue(any("yo'q" in step.text for step in run.steps.filter(actor="system")))


class ScopeTests(CommandTestCase):
    """What a shared flow may do to your workspace, and where it says so."""

    @SCRIPTS
    def test_an_undeclared_scope_stops_the_script(self):
        """`bot` is granted, `user` is not — and the tag never happens, nor does
        the message *after* it, because the script stopped where it asked."""
        self.make_greeting(script=script("bot", "bot.send('Bir'); user.tag('vip'); bot.send('Ikki');"))

        with self.assertLogs("apps.engine.runner", "WARNING"):
            run = self.greet()

        self.assertTrue(
            any("«user» ruxsati yo'q. Script panelida uni yoqing." in line for line in self.faults(run)),
            self.faults(run),
        )
        self.assertEqual(self.said(run), ["Salom!"], "and the send before it did not happen either")
        self.assertEqual(run.contact.tags.count(), 0)

    @SCRIPTS
    def test_a_flow_with_no_grant_at_all_may_still_compute(self):
        """Deny by default has to leave the old feature alone: a hook that only
        returns variables has never needed a scope and still does not."""
        self.make_greeting(script="function onFlowStart(ctx) { return { savat: 3 }; }", says="{{savat}} ta")

        run = self.greet()

        self.assertEqual(self.said(run), ["3 ta"])

    def test_the_grant_is_read_out_of_the_file(self):
        """Which is what makes it survive export, import and duplicate: it is
        part of `Flow.script`, and that column already travels."""
        self.assertEqual(commands.declared_scopes("// @ruxsat: bot, user"), ("bot", "user"))
        self.assertEqual(commands.declared_scopes("/* @scopes: http store */"), ("http", "store"))
        self.assertEqual(commands.declared_scopes("function f() {}"), (), "no directive is no permission")
        self.assertEqual(commands.declared_scopes("// @ruxsat: bot, yolgon"), ("bot",), "a name nobody publishes")


class CeilingTests(CommandTestCase):
    """Five numbers, each of them a deployment's to change."""

    @SCRIPTS
    @override_settings(SCRIPT_MAX_COMMANDS=2)
    def test_the_command_ceiling(self):
        self.make_greeting(script=script("user", "user.set('a', 1); user.set('b', 2); user.set('c', 3);"))

        with self.assertLogs("apps.engine.runner", "WARNING"):
            run = self.greet()

        self.assertTrue(any("juda ko'p amal" in line for line in self.faults(run)), self.faults(run))
        self.assertNotIn("a", run.context, "and none of the three was applied")

    @SCRIPTS
    @override_settings(SCRIPT_MAX_MESSAGES=2)
    def test_the_message_ceiling(self):
        """Two per run because Telegram's own limit is about one message per
        second to one chat — a script that sends six has been rate-limited
        before the sixth goes out."""
        self.make_greeting(script=script("bot", "bot.send('a'); bot.send('b'); bot.send('c');"))

        with self.assertLogs("apps.engine.runner", "WARNING"):
            run = self.greet()

        self.assertTrue(any("juda ko'p xabar" in line for line in self.faults(run)), self.faults(run))
        self.assertEqual(self.said(run), ["Salom!"])

    @SCRIPTS
    @override_settings(SCRIPT_MAX_REQUESTS=1)
    def test_the_outbound_request_ceiling(self):
        self.make_greeting(
            script=script("http", "await http.get('https://a.uz'); await http.get('https://b.uz');")
        )

        with mock.patch("apps.engine.commands._http", return_value=OK_RESPONSE) as fetched:
            with self.assertLogs("apps.engine.runner", "WARNING"):
                run = self.greet()

        self.assertEqual(fetched.call_count, 1, "the second was refused before a socket was opened")
        self.assertTrue(any("juda ko'p tashqi so'rov" in line for line in self.faults(run)), self.faults(run))

    @SCRIPTS
    @override_settings(SCRIPT_MAX_REMINDERS=1)
    def test_the_reminder_ceiling(self):
        self.make_greeting(
            script=script("queue", "queue.remind(10, 'bir', {key:'a'}); queue.remind(20, 'ikki', {key:'b'});")
        )

        with mock.patch("apps.engine.tasks.send_followup.apply_async") as scheduled:
            with self.assertLogs("apps.engine.runner", "WARNING"):
                run = self.greet()

        self.assertEqual(scheduled.call_count, 0, "neither was armed — the list never left the sandbox")
        self.assertTrue(any("juda ko'p eslatma" in line for line in self.faults(run)), self.faults(run))

    @SCRIPTS
    @override_settings(SCRIPT_MAX_TRANSITIONS=1)
    def test_the_block_transition_ceiling(self):
        """Counted on the run and not on the script: two hooks jumping ten
        times each is the same loop as one hook jumping twenty."""
        self.make_survey(script=script("flow", "flow.goto('m1');", hook="onUserMessage"))
        dispatch(self.bot, message_update("/anketa"))

        dispatch(self.bot, callback_update("btn:b1"))
        with self.assertLogs("apps.engine.commands", "WARNING"):
            dispatch(self.bot, callback_update("btn:b1"))

        run = FlowRun.objects.get(flow__name="Oqim")
        self.assertTrue(any("juda ko'p o'tish" in line for line in self.faults(run)), self.faults(run))
        self.assertEqual(self.said(run)[-1], "Rahmat!", "the second jump was refused and the tap took its own exit")


class FailedCommandTests(CommandTestCase):
    """A command that cannot be done must never be a customer's silence."""

    def apply_one(self, run, command: dict):
        """One list, applied the way `_fire` applies one."""
        return commands.apply(run, [command], hook="onFlowStart", node=run.flow.node("m1"))

    def test_a_refused_send_leaves_the_conversation_walking(self):
        """The discipline `runner._fire` already holds for a hook that throws,
        extended to the actions it asks for: one line in the trace, and the run
        is exactly where it was."""
        self.make_greeting()
        run = self.greet()

        with self.telegram() as client:
            client.return_value.call.side_effect = TelegramError("sendMessage", "CHAT_NOT_FOUND")
            with self.assertLogs("apps.engine.commands", "WARNING"):
                directive = self.apply_one(run, {"op": "bot.send", "text": "Salom", "buttons": []})

        failures = [step for step in run.steps.filter(payload__kind="command")]
        self.assertEqual(len(failures), 1, "one fault, one line")
        self.assertEqual(failures[0].payload["op"], "bot.send")
        self.assertIn("CHAT_NOT_FOUND", failures[0].text)
        self.assertEqual(directive.op, "", "and nowhere new to walk")
        self.assertEqual(FlowRun.objects.get(pk=run.pk).status, FlowRun.Status.DONE)

    def test_the_rest_of_the_list_still_runs(self):
        """A tag that fails is not a reason to drop the message behind it."""
        self.make_greeting()
        run = self.greet()

        with self.assertLogs("apps.engine.commands", "WARNING"):
            commands.apply(
                run,
                [{"op": "user.set", "name": "a-b", "value": 1}, {"op": "user.set", "name": "savat", "value": 3}],
                hook="onFlowStart",
                node=run.flow.node("m1"),
            )

        self.assertEqual(run.context["savat"], 3)
        self.assertNotIn("a-b", run.context, "a name no placeholder could read back")

    def test_an_unknown_command_is_one_line_and_not_a_crash(self):
        """A graph, and now a script, can come from a newer build than this one."""
        self.make_greeting()
        run = self.greet()

        with self.assertLogs("apps.engine.commands", "WARNING"):
            commands.apply(run, [{"op": "bot.hologram"}], hook="onFlowStart", node=run.flow.node("m1"))

        self.assertTrue(any("bot.hologram" in step.text for step in run.steps.filter(payload__kind="command")))


class EffectTests(CommandTestCase):
    """`http` and `store` — the half that cannot be a list, and how it is answered."""

    @SCRIPTS
    def test_an_awaited_answer_reaches_the_script(self):
        """Which is the whole point of the halt: the script stops at its
        `await`, the host fetches, and the *same* script runs again with the
        answer in hand."""
        self.make_greeting(
            script=script("http", "const r = await http.get('https://narx.uz/x'); return { narx: r.body.narx };"),
            says="Narxi {{narx}}.",
        )

        with mock.patch("apps.engine.commands._http", return_value=OK_RESPONSE):
            run = self.greet()

        self.assertEqual(self.said(run), ["Narxi 5."])

    @SCRIPTS
    def test_a_request_is_performed_once_however_many_rounds_it_takes(self):
        """The property replay lives or dies on. Two sequential calls are two
        rounds and three launches, and neither call happens twice."""
        self.make_greeting(
            script=script("http", "await http.get('https://a.uz'); await http.get('https://b.uz');")
        )

        with mock.patch("apps.engine.commands._http", return_value=OK_RESPONSE) as fetched:
            self.greet()

        self.assertEqual([call.args[0]["url"] for call in fetched.call_args_list], ["https://a.uz", "https://b.uz"])

    @SCRIPTS
    def test_incr_is_the_number_a_queue_is_built_on(self):
        """Twice in one script and once more in the next conversation: four
        customers, four numbers, and no replay hands one out twice."""
        self.make_greeting(
            script=script("store", "const a = await store.incr('navbat'); const b = await store.incr('navbat');"
                          " return { a, b };"),
            says="{{a}} va {{b}}",
        )

        first = self.said(self.greet())
        second = self.said(self.greet())

        self.assertEqual(first, ["1 va 2"])
        self.assertEqual(second, ["3 va 4"])

    @SCRIPTS
    def test_a_value_written_this_run_is_readable_without_a_second_round(self):
        """`set` is a command and `get` is an effect, so a script that writes
        and then reads would otherwise pay a whole process launch to be told
        what it just wrote."""
        self.make_greeting(
            script=script("store", "await store.set('holat', 'tayyor'); return { h: await store.get('holat') };"),
            says="{{h}}",
        )

        run = self.greet()

        self.assertEqual(self.said(run), ["tayyor"])
        self.assertEqual(cache.get(commands._store_key(self.bot.id, "holat")), "tayyor", "and it really was written")

    @SCRIPTS
    def test_a_refused_request_is_catchable_where_the_author_wrote_the_await(self):
        self.make_greeting(
            script=script(
                "http",
                "try { await http.get('https://a.uz'); return { ok: 1 }; }"
                " catch (e) { return { ok: 0 }; }",
            ),
            says="{{ok}}",
        )

        with mock.patch("apps.engine.commands._http", return_value={"ok": False, "error": "HTTP xato"}):
            run = self.greet()

        self.assertEqual(self.said(run), ["0"])

    def test_only_https_leaves_the_machine(self):
        """Stricter than the «HTTP» block, and deliberately: this URL was typed
        into code rather than into a field somebody reviews, and a bearer token
        pasted into a plaintext call is the one mistake refusing it prevents."""
        answer = commands._http({"url": "http://narx.uz/x", "method": "GET"})

        self.assertFalse(answer["ok"])
        self.assertIn("https://", answer["error"])

    def test_an_address_inside_the_network_is_refused_before_a_socket_opens(self):
        answer = commands._http({"url": "https://127.0.0.1/latest/meta-data", "method": "GET"})

        self.assertFalse(answer["ok"])
        self.assertIn("rad etildi", answer["error"])


class QueueTests(CommandTestCase):
    """A reminder a script armed, riding the one scheduler the runtime has."""

    @SCRIPTS
    def test_a_reminder_is_armed_and_carries_its_own_words(self):
        self.make_greeting(script=script("queue", "queue.remind(30, 'Buyurtmangiz kutmoqda', {key:'savat'});"))

        with mock.patch("apps.engine.tasks.send_followup.apply_async") as scheduled:
            run = self.greet()

        self.assertEqual(scheduled.call_args.kwargs["countdown"], 30 * 60)
        self.assertEqual(run.context[commands.QUEUE]["savat"]["text"], "Buyurtmangiz kutmoqda")

    @SCRIPTS
    def test_the_same_key_overwrites_the_pending_one(self):
        """A task already in flight cannot be recalled from Celery, so the
        older one has to find a serial that is not its own and do nothing."""
        self.make_greeting(
            script=script("queue", "queue.remind(30, 'birinchi', {key:'k'}); queue.remind(5, 'ikkinchi', {key:'k'});")
        )

        with mock.patch("apps.engine.tasks.send_followup.apply_async") as scheduled:
            run = self.greet()

        stale, fresh = (call.kwargs["args"][1] for call in scheduled.call_args_list)
        self.assertEqual(run.context[commands.QUEUE]["k"]["text"], "ikkinchi")
        self.assertIsNone(commands.pending_reminder(run, stale), "the first task now delivers nothing")
        self.assertEqual(commands.pending_reminder(run, fresh)["text"], "ikkinchi")

    def test_a_cancelled_reminder_is_not_a_missing_block(self):
        """`deliver_followup` reaches for a block on the canvas and there is
        none. Told apart from a real fault, because neither is worth a line."""
        from apps.engine.runner import deliver_followup

        self.make_greeting()
        run = self.greet()

        self.assertEqual(deliver_followup(run, f"{commands.QUEUE_NODE_PREFIX}k#1", None), "cancelled")


class EnvelopeTests(CommandTestCase):
    """The wire between the sandbox and here, and what it does with older shapes."""

    def test_an_answer_that_is_not_an_envelope_is_read_as_a_return_value(self):
        """Every test in `test_hooks` that stands in for the sandbox hands back
        a bare object, and so does anything written before this existed."""
        envelope = commands.read({"savat": 3})

        self.assertEqual(envelope.value, {"savat": 3})
        self.assertEqual(envelope.commands, ())
        self.assertFalse(envelope.halted)

    def test_a_halted_round_carries_no_commands(self):
        """What makes replay free of half-done work: a round that did not finish
        is thrown away whole, and only the answers survive it."""
        envelope = commands.read(
            {"__oqim": 1, "halted": True, "pending": [{"id": "0", "kind": "http"}], "commands": []}
        )

        self.assertTrue(envelope.halted)
        self.assertEqual(envelope.commands, ())
        self.assertEqual(envelope.pending[0]["id"], "0")

    def test_a_hook_that_never_settles_gives_up_rather_than_looping(self):
        """A script the host can never satisfy — every round asks for one more
        thing — is a bounded number of launches and then a sentence."""
        halted = ScriptResult(ok=True, value={"__oqim": 1, "halted": True, "pending": [{"id": "0", "kind": "store"}]})
        self.make_greeting(script=script("store", "await store.get('x');"))

        with override_settings(SCRIPT_MAX_ROUNDS=3):
            with mock.patch("apps.engine.hooks.run_script", return_value=halted) as launched:
                with self.assertLogs("apps.engine.runner", "WARNING"):
                    run = self.greet()

        self.assertEqual(launched.call_count, 3)
        self.assertTrue(any("juda ko'p marta kutdi" in line for line in self.faults(run)), self.faults(run))
        self.assertEqual(self.said(run), ["Salom!"], "and the conversation happened anyway")
