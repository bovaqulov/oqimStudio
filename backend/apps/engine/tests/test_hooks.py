"""The flow's own script, at the three moments the runtime calls it.

`test_script.py` asks what a script *does*; this asks when it runs and what the
conversation carries afterwards. The distinction the whole file turns on is the
one `hooks.call` draws and the runtime has to keep: a file that does not declare
a hook starts no process at all, which is a different event from a hook that ran
and threw — only the first of them is silent.

Two conventions here. The tests that really run JavaScript are marked with
`SCRIPTS`, the same skip `test_script.py` and `test_script_concurrency.py` use,
because a deployment without Node is a supported one. The rest stand in for the
sandbox deliberately: what they are about is the runtime's half of the call —
how many times it happens, with what, and what becomes of the answer — and
counting launches is more honest with the launcher mocked.
"""

from unittest import mock, skipUnless

from apps.engine.runner import _finish, resume_with_reply, start_run
from apps.engine.script import ScriptResult, is_available

from .base import *  # noqa: F401,F403

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")

#: A file declaring all three, so that what is being counted is the runtime's
#: decision to call and never the regex's decision to answer.
ALL_THREE = """
function onFlowStart(ctx) { return {}; }
function onUserMessage(ctx) { return {}; }
function onFlowEnd(ctx) { return {}; }
"""

#: A script the sandbox never has to run — every test that uses it mocks the
#: call underneath.
QUIET = ScriptResult(ok=True, value={})


class HookTestCase(EngineTestCase):
    """Two graphs: one that runs to its own end, one that parks on a button."""

    def make_greeting(self, **extra):
        """Trigger, one message, end of graph — a run that starts and finishes."""
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "salom"}},
                {"id": "m1", "type": "message", "text": extra.pop("says", "Salom!")},
            ],
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}],
            **extra,
        )

    def make_survey(self, **extra):
        """The same, with a button in the middle — a run that parks and resumes."""
        return self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "anketa"}},
                {"id": "m1", "type": "message", "text": "Nechta?", "buttons": [{"id": "b1", "label": "Ikkita"}]},
                {"id": "m2", "type": "message", "text": extra.pop("thanks", "Rahmat!")},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "m1"},
                {"id": "e2", "from": "m1", "port": "btn:b1", "to": "m2"},
            ],
            **extra,
        )

    def greet(self) -> FlowRun:
        return FlowRun.objects.get(pk=dispatch(self.bot, message_update("/salom"))["runId"])

    def hooks_called(self, calls) -> list[str]:
        """Which hooks were asked for, in order — `hooks.call` takes it first."""
        return [call.args[0] for call in calls]

    def hook_faults(self, run: FlowRun) -> list:
        return [step for step in run.steps.filter(actor="system") if step.payload.get("kind") == "hook"]


class NoScriptTests(HookTestCase):
    """What a flow without a script pays for the feature: nothing.

    Most flows have no script and every run walks this path, so the cost of the
    empty case is the cost of the feature for almost everybody. A regex over an
    empty string is cheap; the context built to hand it is not, and neither is
    the process a careless version would launch to be told there is no hook.
    """

    def test_a_flow_with_no_script_never_reaches_the_sandbox(self):
        self.make_greeting()

        with mock.patch("apps.engine.hooks.call") as called:
            run = self.greet()

        called.assert_not_called()
        self.assertEqual(run.status, FlowRun.Status.DONE, "and the conversation happened anyway")

    def test_a_script_of_only_whitespace_is_no_script(self):
        """What the editor stores for a panel somebody opened and closed again."""
        self.make_greeting(script="\n   \n")

        with mock.patch("apps.engine.hooks.call") as called:
            self.greet()

        called.assert_not_called()

    def test_a_flow_with_a_script_does_reach_it(self):
        """The other half of the two above — an assertion that cannot fail is
        not an assertion, and `assert_not_called` on a feature nobody wired
        passes beautifully."""
        self.make_greeting(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            self.greet()

        self.assertEqual(self.hooks_called(called.call_args_list), ["onFlowStart", "onFlowEnd"])

    def test_the_call_names_the_flow_the_library_and_the_tenant(self):
        """The workspace is the slot the launch is charged to (`script.concurrency`);
        charging it to nobody is how one bot's arithmetic becomes everybody's queue."""
        self.bot.script_library = "function narx() { return 1; }"
        self.bot.save(update_fields=["script_library"])
        flow = self.make_greeting(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            self.greet()

        first = called.call_args_list[0]
        self.assertEqual(first.kwargs["script"], flow.script)
        self.assertEqual(first.kwargs["library"], self.bot.script_library)
        self.assertEqual(first.kwargs["workspace_id"], self.workspace.id)


class LaunchCountTests(HookTestCase):
    """How many Node processes one conversation is worth.

    The arithmetic in `hooks`' own docstring is the reason there are three hooks
    and not five, and it only holds if an undeclared hook really does cost
    nothing. `run_script` is mocked because it *is* the launch: counting it is
    counting processes.
    """

    def test_a_script_that_declares_only_onflowstart_starts_no_process_for_the_end(self):
        self.make_greeting(script="function onFlowStart(ctx) { return {}; }")

        with mock.patch("apps.engine.hooks.run_script", return_value=QUIET) as launched:
            self.greet()

        self.assertEqual(launched.call_count, 1, "one hook declared is one process, start to finish")

    def test_a_conversation_that_parks_and_resumes_costs_one_launch_per_hook(self):
        self.make_survey(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.run_script", return_value=QUIET) as launched:
            dispatch(self.bot, message_update("/anketa"))
            dispatch(self.bot, callback_update("btn:b1"))

        self.assertEqual(launched.call_count, 3, "start, the tap, and the end — and nothing per block")


@SCRIPTS
class WrittenBackTests(HookTestCase):
    """What a hook returns becomes variables, the way a «Ma'lumotni saqlash»
    block's answer does — the same context, the same names, the same `{{...}}`."""

    def test_onflowstart_writes_into_the_runs_variables(self):
        self.make_greeting(script="function onFlowStart(ctx) { return { savat: 3 }; }")

        run = self.greet()

        self.assertEqual(run.context["savat"], 3)

    def test_the_variable_survives_a_reload_from_the_database(self):
        """A run parks for days. A value that only ever existed on the object
        the webhook happened to be holding is a value the next update cannot
        read."""
        self.make_greeting(script="function onFlowStart(ctx) { return { savat: 3 }; }")
        run = self.greet()

        self.assertEqual(FlowRun.objects.get(pk=run.pk).context["savat"], 3)

    def test_the_first_block_can_already_render_it(self):
        """Which is the whole reason the hook fires before `walk` and not inside
        it: a greeting saying `{{savat}}` is what an author writes one for."""
        self.make_greeting(
            script="function onFlowStart(ctx) { return { savat: 3 }; }",
            says="Savatingizda {{savat}} ta mahsulot.",
        )

        said = [step.text for step in self.greet().steps.filter(actor="bot")]

        self.assertEqual(said, ["Savatingizda 3 ta mahsulot."])

    def test_a_hook_that_returns_nothing_writes_nothing_and_says_nothing(self):
        self.make_greeting(script="function onFlowStart(ctx) { console.log('bor'); }")

        run = self.greet()

        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual(self.hook_faults(run), [], "a hook that only logs has not failed")

    def test_a_key_no_placeholder_could_name_is_not_written(self):
        """`hooks.writable`'s rule, seen from the runtime: a name `{{...}}`
        cannot read back is a variable carried on every step of the run for the
        rest of the conversation and never read by anything."""
        self.make_greeting(script="function onFlowStart(ctx) { return { 'a-b': 1, ok: 2 }; }")

        run = self.greet()

        self.assertNotIn("a-b", run.context)
        self.assertEqual(run.context["ok"], 2)


@SCRIPTS
class FailingHookTests(HookTestCase):
    """A script only its author can fix must never be a customer's silence."""

    THROWS = "function onFlowStart(ctx) { throw new Error('narx topilmadi'); }"

    def test_the_conversation_walks_on(self):
        self.make_greeting(script=self.THROWS)

        # Logged as well as recorded: the trace is for the author, and the
        # server's own log is where an operator finds out that a bot has been
        # walking past a broken hook all week.
        with self.assertLogs("apps.engine.runner", "WARNING"):
            run = self.greet()

        self.assertEqual([step.text for step in run.steps.filter(actor="bot")], ["Salom!"])
        self.assertEqual(run.status, FlowRun.Status.DONE, "the flow ended the way it would have anyway")

    def test_it_is_one_system_step_the_author_can_read(self):
        self.make_greeting(script=self.THROWS)

        with self.assertLogs("apps.engine.runner", "WARNING"):
            faults = self.hook_faults(self.greet())

        self.assertEqual(len(faults), 1, "one fault, one line in the trace")
        self.assertEqual(faults[0].payload["kind"], "hook", "the same shape a failed expression writes")
        self.assertEqual(faults[0].payload["hook"], "onFlowStart", "which of the three it was")
        self.assertIn("narx topilmadi", faults[0].text, "the author's own message, not a wrapper's")

    def test_a_hook_that_is_not_there_writes_no_step_at_all(self):
        """The distinction the feature turns on: a flow with no `onFlowEnd` is
        not a flow whose `onFlowEnd` failed."""
        self.make_greeting(script=self.THROWS)

        with self.assertLogs("apps.engine.runner", "WARNING"):
            faults = self.hook_faults(self.greet())

        self.assertEqual([step.payload["hook"] for step in faults], ["onFlowStart"])

    def test_a_sandbox_that_raises_does_not_take_the_run_with_it(self):
        """Not the script failing — `hooks.call` answers that with an outcome —
        but this module or the sandbox underneath it going wrong. `_finish` is
        one of the three callers, so a raise escaping here would finish a run in
        the database and crash the worker on the way out."""
        self.make_greeting(script=self.THROWS)

        with mock.patch("apps.engine.hooks.call", side_effect=RuntimeError("qutisi buzildi")):
            with self.assertLogs("apps.engine.runner", "ERROR"):
                run = self.greet()

        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertEqual([step.text for step in run.steps.filter(actor="bot")], ["Salom!"])


class FlowEndTests(HookTestCase):
    """`onFlowEnd` fires once for a run that ends, and once is the hard part.

    `_finish` is reached from the ordinary end of `walk`, from a `TelegramError`,
    from the generic `except` around a block, from `_handle_end` and from
    `_continue_from` — and the run object is the same one each time.
    """

    def test_it_fires_exactly_once_for_a_run_that_finishes(self):
        self.make_greeting(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            self.greet()

        self.assertEqual(self.hooks_called(called.call_args_list).count("onFlowEnd"), 1)

    def test_a_run_finished_twice_still_fires_it_once(self):
        """A hook that raised inside `_handle_end` lands in `walk`'s own
        `except`, which finishes the same run again. Firing twice there would
        run an author's billing code twice on one conversation."""
        self.make_survey(script=ALL_THREE)
        dispatch(self.bot, message_update("/anketa"))
        parked = FlowRun.objects.get(status=FlowRun.Status.WAITING)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            _finish(parked, FlowRun.Status.DONE)
            _finish(parked, FlowRun.Status.FAILED, "ikkinchi marta")

        self.assertEqual(self.hooks_called(called.call_args_list), ["onFlowEnd"])

    def test_a_run_that_fails_still_ends(self):
        """Every terminal outcome, not only the happy one — a flow charging a
        card in `onFlowEnd` has to hear about the conversation that broke."""
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "salom"}},
                {"id": "m1", "type": "message", "text": "Salom!"},
            ],
            # An edge to a block that is not in the graph: `walk` cannot find it
            # and finishes the run FAILED.
            [{"id": "e1", "from": "c1", "port": "out", "to": "m1"}, {"id": "e2", "from": "m1", "port": "out", "to": "yo'q"}],
            script=ALL_THREE,
        )

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            run = self.greet()

        self.assertEqual(run.status, FlowRun.Status.FAILED)
        self.assertEqual(self.hooks_called(called.call_args_list).count("onFlowEnd"), 1)

    def test_the_run_is_written_down_before_the_hook_runs(self):
        """A worker killed inside an author's code has to leave a finished run
        behind it, not a running one nothing will ever wake."""
        self.make_greeting(script=ALL_THREE)
        seen = {}

        def look(hook, **kwargs):
            if hook == "onFlowEnd":
                seen["status"] = FlowRun.objects.get(flow__name="Oqim").status
            return None

        with mock.patch("apps.engine.hooks.call", side_effect=look):
            self.greet()

        self.assertEqual(seen["status"], FlowRun.Status.DONE)


class UserMessageTests(HookTestCase):
    """`onUserMessage` — once per reply, before the block that was waiting acts."""

    def parked(self) -> FlowRun:
        dispatch(self.bot, message_update("/anketa"))
        return FlowRun.objects.get(status=FlowRun.Status.WAITING)

    def test_it_fires_once_when_a_parked_run_is_resumed(self):
        self.make_survey(script=ALL_THREE)
        self.parked()

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            dispatch(self.bot, callback_update("btn:b1"))

        self.assertEqual(self.hooks_called(called.call_args_list), ["onUserMessage", "onFlowEnd"])

    def test_a_tap_reaches_it_as_the_row_the_customer_pressed(self):
        """`btn:b1` is the wire's name for the port. Nobody said it, and a hook
        reading `ctx.message.text` is reading what a person typed or pressed."""
        self.make_survey(script=ALL_THREE)
        self.parked()

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            dispatch(self.bot, callback_update("btn:b1"))

        ctx = called.call_args_list[0].kwargs["ctx"]
        self.assertEqual(ctx["message"]["text"], "Ikkita")

    def test_the_block_in_the_context_is_the_one_that_was_waiting(self):
        self.make_survey(script=ALL_THREE)
        self.parked()

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            dispatch(self.bot, callback_update("btn:b1"))

        self.assertEqual(called.call_args_list[0].kwargs["ctx"]["block"]["id"], "m1")

    def test_a_typed_answer_arrives_as_the_words_that_were_typed(self):
        """The studio's test chat resumes a run with whatever the author typed
        into it (`flows.views`), commands included — which is the only path a
        command reaches this hook by, `dispatch._reply_port` refusing one as an
        answer."""
        self.make_survey(script=ALL_THREE)
        run = self.parked()

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            resume_with_reply(run, text="/tugat", port="out")

        message = called.call_args_list[0].kwargs["ctx"]["message"]
        self.assertEqual(message["text"], "/tugat")
        self.assertEqual(message["command"], "tugat")

    @SCRIPTS
    def test_what_it_writes_is_rendered_by_the_block_the_customer_reads_next(self):
        self.make_survey(
            script="function onUserMessage(ctx) { return { javob: ctx.message.text }; }",
            thanks="Siz «{{javob}}» dedingiz.",
        )
        self.parked()

        dispatch(self.bot, callback_update("btn:b1"))

        run = FlowRun.objects.get(status=FlowRun.Status.DONE)
        self.assertEqual([step.text for step in run.steps.filter(actor="bot")][-1], "Siz «Ikkita» dedingiz.")


class TestRunTests(HookTestCase):
    """The editor's test chat runs the same code, so it runs the same hooks —
    an author testing a script has to be testing the one Telegram will run."""

    def test_a_test_run_fires_them_too(self):
        flow = self.make_greeting(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            start_run(flow=flow, entry_node_id="c1", is_test=True)

        self.assertEqual(self.hooks_called(called.call_args_list), ["onFlowStart", "onFlowEnd"])

    def test_the_context_says_which_it_is(self):
        flow = self.make_greeting(script=ALL_THREE)

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            start_run(flow=flow, entry_node_id="c1", is_test=True)

        self.assertEqual(called.call_args_list[0].kwargs["ctx"]["mode"], "test")


class SupersededRunTests(HookTestCase):
    """The ending nobody walks to.

    A customer who types a new command while a run is parked never reaches the
    end of the first one — `dispatch._close_superseded_runs` closes it behind
    them. That is a real ending of a real conversation, and it was the one path
    that wrote its own four columns instead of going through `_finish`: no
    `run.finished` published, and once flows grew hooks, no `onFlowEnd`. An
    author cannot write a hook that fires at four endings out of five and be
    told which one is missing.
    """

    def test_a_run_left_behind_still_ends_its_flow(self):
        self.make_survey(script=ALL_THREE)
        self.make_greeting(script=ALL_THREE)
        dispatch(self.bot, message_update("/anketa"))
        self.assertTrue(FlowRun.objects.filter(status=FlowRun.Status.WAITING).exists())

        with mock.patch("apps.engine.hooks.call", return_value=None) as called:
            # A different command: the parked survey is superseded rather than
            # answered, which is the branch under test.
            dispatch(self.bot, message_update("/salom"))

        # Two runs ended in that update — the abandoned survey and the greeting
        # that replaced it — and the hook belongs to both.
        self.assertEqual(self.hooks_called(called.call_args_list).count("onFlowEnd"), 2)

    def test_it_still_says_why_it_ended(self):
        """The sentence the run carries is what the activity log shows, and
        routing this through `_finish` must not quietly drop it."""
        self.make_survey(script=ALL_THREE)
        self.make_greeting(script=ALL_THREE)
        dispatch(self.bot, message_update("/anketa"))
        survey = FlowRun.objects.get(status=FlowRun.Status.WAITING)

        dispatch(self.bot, message_update("/salom"))

        survey.refresh_from_db()
        self.assertEqual(survey.status, FlowRun.Status.DONE)
        self.assertIn("/salom", survey.error)
        self.assertEqual(survey.current_node_id, "")

