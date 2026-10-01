"""The HTTP block and the SSRF guard in front of it."""

from .base import *  # noqa: F401,F403


class SsrfGuardTests(TestCase):
    """The HTTP block must not become a way into the network it runs inside.

    A flow author is an authenticated tenant, and on a shared install the server
    makes this request from inside the perimeter — so "any URL the author typed"
    includes the cloud metadata endpoint and everything on loopback. These check
    the guard, not the network: the resolver is mocked, so no packet leaves.
    """

    def test_a_private_address_is_refused_before_any_socket_opens(self):
        from apps.engine.safe_http import UnsafeUrlError, safe_get

        for url in [
            "http://169.254.169.254/latest/meta-data/",  # cloud metadata
            "http://127.0.0.1:8000/api/",  # loopback
            "http://localhost/admin/",
            "http://10.0.0.5/internal",  # RFC1918
            "http://192.168.1.1/",
            "http://[::1]/",  # IPv6 loopback
        ]:
            with self.assertRaises(UnsafeUrlError, msg=url):
                safe_get(url)

    def test_a_non_http_scheme_is_refused(self):
        from apps.engine.safe_http import UnsafeUrlError, safe_get

        for url in ["file:///etc/passwd", "gopher://127.0.0.1:6379/", "ftp://internal/"]:
            with self.assertRaises(UnsafeUrlError, msg=url):
                safe_get(url)

    def test_a_redirect_onto_a_private_address_is_not_followed(self):
        from apps.engine import safe_http

        # A public host that 302s to the metadata endpoint. `requests` would
        # follow it; the guard re-checks the hop and refuses.
        with mock.patch.object(safe_http, "_is_public_address", side_effect=lambda h: h == "public.example"):
            with mock.patch.object(safe_http.requests, "get") as get:
                redirect = mock.Mock(is_redirect=True)
                redirect.next = mock.Mock(url="http://169.254.169.254/")
                get.return_value = redirect

                with self.assertRaises(safe_http.UnsafeUrlError):
                    safe_http.safe_get("http://public.example/start")

    def test_a_public_url_is_allowed_through(self):
        from apps.engine import safe_http

        with mock.patch.object(safe_http, "_is_public_address", return_value=True):
            with mock.patch.object(safe_http.requests, "get") as get:
                get.return_value = mock.Mock(is_redirect=False, status_code=200)
                response = safe_http.safe_get("https://api.example.com/data")

        self.assertEqual(response.status_code, 200)
        # allow_redirects is off — the guard follows hops itself so it can check them.
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_the_body_is_read_with_a_ceiling(self):
        from apps.engine.safe_http import MAX_BODY_BYTES, read_capped

        response = mock.Mock()
        response.iter_content = lambda size: iter([b"x" * 8192 for _ in range(1000)])
        body = read_capped(response)

        self.assertEqual(len(body), MAX_BODY_BYTES)


class HttpBlockTests(EngineTestCase):
    """The block still does its job for a URL that is allowed."""

    def test_a_public_url_lands_in_the_context(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx"}},
                {"id": "h1", "type": "http", "text": "https://api.example.com/price"},
                {"id": "m1", "type": "message", "text": "Narx: {{http}}"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "h1"},
                {"id": "e2", "from": "h1", "port": "out", "to": "m1"},
            ],
        )
        with mock.patch("apps.engine.runner.safe_get") as safe_get,                 mock.patch("apps.engine.runner.read_capped", return_value=b'{"price": 500}'):
            safe_get.return_value = mock.Mock(status_code=200)
            run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/narx"))["runId"])

        self.assertIn("Narx: {'price': 500}", run.steps.filter(actor="bot").last().text)

    def test_an_internal_url_is_refused_without_dropping_the_run(self):
        self.make_flow(
            [
                {"id": "c1", "type": "trigger", "dmsTrigger": {"kinds": ["command"], "command": "narx2"}},
                {"id": "h1", "type": "http", "text": "http://169.254.169.254/latest/meta-data/"},
                {"id": "m1", "type": "message", "text": "Davom etdi"},
            ],
            [
                {"id": "e1", "from": "c1", "port": "out", "to": "h1"},
                {"id": "e2", "from": "h1", "port": "out", "to": "m1"},
            ],
            name="Ichki",
        )
        run = FlowRun.objects.get(pk=dispatch(self.bot, message_update("/narx2"))["runId"])

        # The metadata endpoint was refused, and the flow walked on to the next
        # block rather than the request being made.
        self.assertEqual(run.status, FlowRun.Status.DONE)
        self.assertIn("Davom etdi", run.steps.filter(actor="bot").last().text)
        self.assertTrue(run.steps.filter(text__contains="rad etildi").exists())
