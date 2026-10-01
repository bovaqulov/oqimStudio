"""A contract, not a unit test: the editor's test chat against the real keyboard.

The panel in `frontend/src/features/flow-builder/lib/test-session.ts` is the
one place an author can try a flow before a customer does. It drives this
engine — the walking is real — but what it *offers* to press is read off the
stored graph on the browser's side, and that list has to be the keyboard
`sender.build_keyboard` would actually send. When it is short of a row, the
author draws an exit, the validator accepts it, the runtime knows how to route
it, and the only thing that can tell them whether it works is a live customer.
That is how the «Orqaga» and «O'tkazib yuborish» exits went untestable: both
rows shipped, and neither was ever on offer in the chat that exists to press
them.

**When it fails.** Either the runtime grew a row the test chat does not offer,
or the test chat stopped offering one. Open `sender.build_keyboard` and read
what it draws for the block in question, then make the panel's option list say
the same thing. Do not delete the port from the expected set to make this pass:
the set is derived from `sender`'s own constants, so shortening it means
deleting a row the runtime still sends.

It reads the TypeScript with a regular expression rather than by running it,
for the same reason `apps/flows/tests_vocabulary_contract.py` does: the backend
suite must not need Node, a toolchain or an `npm install` to run. A parse that
finds nothing at all fails loudly rather than quietly asserting nothing.

The check is limited to **which exits are named**. Whether each one is offered
under the right condition is the panel's own business and cannot be read out of
the source with a regex; what can be, and what costs conversations when it is
wrong, is an exit the chat has no word for at all.
"""

from __future__ import annotations

import re
from pathlib import Path

from django.test import SimpleTestCase

from apps.engine import sender

#: `backend/apps/engine/tests/` -> repo root -> the panel's option list.
TEST_SESSION_PATH = (
    Path(__file__).resolve().parents[4]
    / "frontend"
    / "src"
    / "features"
    / "flow-builder"
    / "lib"
    / "test-session.ts"
)

#: `{ label: …, port: "back" }` — every exit the panel names in a literal.
PORT_LITERAL = re.compile(r"""port:\s*["']([a-z_]+)["']""")

#: The one exit no row of `build_keyboard`'s carries: money settling arrives as
#: an update of its own rather than as a tap, and the Pay button Telegram puts
#: on an invoice is what leads to it. Everything else below is derived.
PAYMENT_PORT = "paid"


def block_owned_ports() -> set[str]:
    """Exits a *block* owns, read off `sender` rather than listed here.

    Each one is a row `build_keyboard` draws itself — «Bekor», «O'tkazib
    yuborish», «Orqaga», the gate's check row — and each is declared as a
    callback constant whose data is `port:<exit>`. The module that draws the
    rows is therefore also the register of which rows exist, so a new one
    cannot be added without this test noticing that the chat cannot press it.
    """
    prefix = "port:"
    return {
        value[len(prefix) :]
        for name, value in vars(sender).items()
        if name.isupper() and isinstance(value, str) and value.startswith(prefix)
    }


class TestChatOffersEveryExitTests(SimpleTestCase):
    """Every exit the runtime can park on has a word in the test chat."""

    def setUp(self) -> None:
        self.assertTrue(TEST_SESSION_PATH.is_file(), f"the panel moved: {TEST_SESSION_PATH}")
        self.source = TEST_SESSION_PATH.read_text(encoding="utf-8")
        self.named = set(PORT_LITERAL.findall(self.source))
        self.assertTrue(self.named, "no `port:` literal found at all — the regex, not the panel, is what broke")

    def test_the_register_of_block_owned_exits_is_not_empty(self):
        """The derivation itself, so a rename in `sender` cannot quietly empty
        the expected set and turn this file into a test that asserts nothing."""
        self.assertIn("back", block_owned_ports())
        self.assertIn("cancelled", block_owned_ports())

    def test_every_block_owned_row_can_be_pressed_in_the_test_chat(self):
        missing = sorted((block_owned_ports() | {PAYMENT_PORT}) - self.named)
        self.assertEqual(
            missing,
            [],
            "rows `sender.build_keyboard` sends that the test chat never offers — "
            "an author can draw these exits and nobody can take them",
        )

    def test_the_authors_own_buttons_are_offered_by_their_port(self):
        """A button's exit is `btn:<id>`, which is spelled by `buttonPortId` and
        so cannot appear as a literal above."""
        self.assertIn("buttonPortId", self.source)
