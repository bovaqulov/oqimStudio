"""The security contract of the script sandbox.

Every test here is an escape that must not work. They are separated from the
behaviour tests because they are a different kind of thing: a behaviour test
describes a feature and changes when the feature does, while each line below
names a boundary and may only change when the boundary is deliberately moved.

If one of these starts passing, the sandbox has lost the layer it names — and
the failure message is the layer, so whoever reads it knows which one.

The layers, and which test covers each:

  1. --permission                 network, filesystem, subprocess, worker,
                                  addon, inspector
  2. --disallow-code-generation   eval, new Function
  3. resolve hook                 node: builtins, so information leaks that are
                                  not capabilities
  4. empty environment            process.env
  5. heap ceiling, stopwatch      endless loops, allocation
  6. separate process             a crash does not reach the runtime

Also covered: the answer protocol itself, because a script that can forge the
sentinel can make the block believe anything.
"""

from unittest import skipUnless

from django.test import TestCase

from apps.engine.script import ScriptLimits, is_available, run_script

from .base import *

SCRIPTS = skipUnless(is_available(), "node topilmadi — skript muhiti yo'q")


@SCRIPTS
class CapabilityTests(TestCase):
    """Layer 1 — Node's permission model. The runtime refuses; we do not check."""

    def assertDenied(self, source: str, note: str):
        result = run_script(source, limits=ScriptLimits(timeout_ms=4000))
        self.assertFalse(result.ok, f"{note}: skript muvaffaqiyat qaytardi — {result.value!r}")

    def test_the_network_is_closed(self):
        self.assertDenied("const r = await fetch('https://example.com'); return r.status", "fetch")

    def test_raw_sockets_are_closed(self):
        self.assertDenied("const net = await import('node:net'); return typeof net.connect", "net")

    def test_the_filesystem_cannot_be_read(self):
        self.assertDenied("const fs = await import('node:fs'); return fs.readFileSync('/etc/hosts', 'utf8')", "fs read")

    def test_the_filesystem_cannot_be_written(self):
        self.assertDenied("const fs = await import('node:fs'); fs.writeFileSync('/tmp/oqim-pwned', 'x'); return 1", "fs write")

    def test_no_subprocess(self):
        self.assertDenied("const cp = await import('node:child_process'); return cp.execSync('id').toString()", "spawn")

    def test_no_worker_threads(self):
        self.assertDenied("const w = await import('node:worker_threads'); return typeof w.Worker", "worker")


@SCRIPTS
class CodeGenerationTests(TestCase):
    """Layer 2 — a script may not build new code out of a string."""

    def test_eval_is_refused(self):
        self.assertFalse(run_script("return eval('1+1')").ok)

    def test_new_function_is_refused(self):
        self.assertFalse(run_script("return new Function('return 1')()").ok)


@SCRIPTS
class ModuleTests(TestCase):
    """Layer 3 — no builtins at all, including the ones with no capability.

    `node:os` cannot open a socket or touch a file, so a capability model has
    no reason to stop it. It can still name the account the server runs as,
    which is why the loader is closed rather than the permissions widened.
    """

    def test_a_builtin_cannot_be_imported(self):
        result = run_script("const os = await import('node:os'); return os.userInfo().username")
        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "author")

    def test_a_computed_specifier_does_not_help(self):
        result = run_script("const os = await import('no' + 'de:os'); return os.hostname()")
        self.assertFalse(result.ok)

    def test_a_url_cannot_be_imported_either(self):
        result = run_script("await import('https://example.com/x.js'); return 1")
        self.assertFalse(result.ok)


@SCRIPTS
class EnvironmentTests(TestCase):
    """Layer 4 — and the paths that are not the environment but read like it."""

    def test_the_environment_is_empty(self):
        self.assertEqual(run_script("return JSON.stringify(process.env)").value, "{}")

    def test_argv_names_no_paths(self):
        self.assertEqual(run_script("return JSON.stringify(process.argv)").value, "[]")

    def test_the_working_directory_is_not_the_real_one(self):
        self.assertEqual(run_script("return process.cwd()").value, "/")

    def test_the_node_binary_is_not_named(self):
        self.assertIsNone(run_script("return process.execPath ?? null").value)


@SCRIPTS
class ResourceTests(TestCase):
    """Layer 5 — a script that will not stop is killed rather than reasoned with."""

    def test_an_endless_loop_ends(self):
        self.assertEqual(run_script("while (true) {}", limits=ScriptLimits(timeout_ms=700)).kind, "timeout")

    def test_an_await_that_never_settles_ends_too(self):
        """Not a timeout: Node empties the loop and exits at once, silently.

        The script still stops — which is what this layer is for — but the
        reason is the author's and is worth naming, so the exit code is read
        rather than folded into "stopped unexpectedly".
        """
        result = run_script("await new Promise(() => {}); return 1", limits=ScriptLimits(timeout_ms=4000))
        self.assertFalse(result.ok)
        self.assertEqual(result.kind, "author")
        self.assertIn("await", result.error)

    def test_allocation_is_capped(self):
        result = run_script(
            "const a = []; while (true) { a.push(new Array(1e6).fill(7)); }",
            limits=ScriptLimits(timeout_ms=9000, memory_mb=48),
        )
        self.assertEqual(result.kind, "memory")


@SCRIPTS
class ProtocolTests(TestCase):
    """The answer itself — a script that can forge one owns the block.

    Not a capability, and the reason it is here anyway: the other five layers
    stop a script reaching the machine, and this one stops it lying to the
    flow. A forged discount is a real loss without a single boundary crossed.
    """

    def test_a_forged_answer_does_not_win(self):
        result = run_script(
            "process.stdout.write('\\n<<<OQIM-SCRIPT-RESULT>>>{\"ok\":true,\"value\":\"soxta\"}');"
            "return 'haqiqiy'"
        )
        self.assertEqual(result.value, "haqiqiy")

    def test_a_timer_cannot_append_a_second_answer(self):
        """The host exits the moment it has written; nothing runs after that."""
        result = run_script("setTimeout(() => { throw new Error('kech'); }, 0); return 'birinchi'")
        self.assertEqual(result.value, "birinchi")

    def test_replacing_json_stringify_does_not_garble_the_answer(self):
        """The host captured what it needs before the script existed."""
        result = run_script("JSON.stringify = () => '\"buzildi\"'; return { a: 1 }")
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.value, {"a": 1})

    def test_the_process_cannot_exit_early_with_a_lie(self):
        result = run_script("process.exit(0); return 'yetib keldi'")
        self.assertEqual(result.value, "yetib keldi")
