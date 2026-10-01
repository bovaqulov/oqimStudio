"""What a socket pass may and may not open."""

from django.test import TestCase

from apps.realtime.tickets import MAX_AGE_SECONDS, mint, read


class TicketTests(TestCase):
    def test_a_pass_reads_back_as_it_was_minted(self):
        self.assertEqual(read(mint("u1", "ws.workspace.a")), ("u1", "ws.workspace.a"))

    def test_a_forged_pass_is_refused(self):
        self.assertIsNone(read("not-a-ticket"))
        self.assertIsNone(read(mint("u1", "ws.workspace.a") + "x"))

    def test_a_stale_pass_is_refused(self):
        from unittest import mock

        ticket = mint("u1", "ws.workspace.a")
        with mock.patch("django.core.signing.time.time", return_value=9_999_999_999):
            self.assertIsNone(read(ticket))

    def test_the_scope_travels_inside_the_signature(self):
        """So it cannot be swapped for another workspace on the way."""
        _, scope = read(mint("u1", "ws.workspace.klinika"))
        self.assertEqual(scope, "ws.workspace.klinika")

    def test_the_window_is_short(self):
        self.assertLessEqual(MAX_AGE_SECONDS, 60)
