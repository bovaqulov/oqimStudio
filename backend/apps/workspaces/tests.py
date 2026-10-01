"""Invite links: who may mint one, what it carries, and what redeeming it does.

The email invite already had coverage through the members endpoint; this is the
half that names no recipient, so the things worth pinning down are the ones the
absence of an address changes — no seat is held, the code is the only thing
handed over, and the link has to survive being read by somebody who is not the
person who made it.
"""

from __future__ import annotations

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.billing.models import Plan, Subscription
from apps.billing.services import usage_report
from apps.workspaces.models import Invite, Membership, Role, Workspace

FRONTEND = "https://panel.example.uz"


@override_settings(FRONTEND_BASE_URL=FRONTEND)
class InviteLinkTests(TestCase):
    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="ega@b.uz", password="Parol12345", name="Ega", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="ws", name="Belting", slug="ws", owner=self.owner)
        Membership.objects.create(
            workspace=self.workspace, user=self.owner, email=self.owner.email, role=Role.OWNER
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _post(self, role: str = Role.EDITOR):
        return self.client.post(
            "/api/workspaces/ws/invite-link/",
            {"role": role},
            format="json",
            HTTP_X_WORKSPACE_ID="ws",
        )

    def test_it_names_both_links_and_the_code_they_carry(self) -> None:
        response = self._post()
        self.assertEqual(response.status_code, 201)
        body = response.json()
        invite = Invite.objects.get(code=body["code"])

        self.assertEqual(body["url"], f"{FRONTEND}/join/{invite.code}")
        # The share URL has to carry the join URL, encoded — a bare `?url=`
        # with slashes in it is a link Telegram truncates at the first `&`.
        self.assertIn("t.me/share/url", body["telegramUrl"])
        self.assertIn("%2Fjoin%2F", body["telegramUrl"])
        self.assertIn(self.workspace.name, response.json()["telegramUrl"].replace("%20", " ").replace("%C2%AB", "«"))

    def test_it_holds_no_seat(self) -> None:
        """The whole difference from an email invite: nobody is named yet."""
        before = self.workspace.memberships.count()
        self._post()
        self.assertEqual(self.workspace.memberships.count(), before)

    def test_redeeming_it_makes_a_member(self) -> None:
        code = self._post(Role.ANALYST).json()["code"]
        joiner = User.objects.create_user(
            email="yangi@b.uz", password="Parol12345", name="Yangi", email_verified=True
        )
        client = APIClient()
        client.force_authenticate(joiner)

        response = client.post("/api/workspaces/join/", {"code": code}, format="json")
        self.assertEqual(response.status_code, 201)
        membership = self.workspace.memberships.get(user=joiner)
        self.assertFalse(membership.invited)
        self.assertEqual(membership.role, Role.ANALYST)

    def test_it_works_once(self) -> None:
        """A link left open in a group chat is open to whoever finds it later."""
        code = self._post().json()["code"]
        for email in ("bir@b.uz", "ikki@b.uz"):
            user = User.objects.create_user(
                email=email, password="Parol12345", name=email, email_verified=True
            )
            client = APIClient()
            client.force_authenticate(user)
            response = client.post("/api/workspaces/join/", {"code": code}, format="json")
            if email == "bir@b.uz":
                self.assertEqual(response.status_code, 201)
            else:
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"]["code"], "invalid_token")

    def test_reading_it_does_not_spend_it(self) -> None:
        """A GET that consumed the code was the bug this endpoint exists for."""
        code = self._post().json()["code"]
        for _ in range(3):
            response = self.client.get(f"/api/workspaces/invite/{code}/")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["usable"])
        self.assertIsNone(Invite.objects.get(code=code).accepted_at)

    def test_the_preview_names_the_workspace_and_the_role(self) -> None:
        code = self._post(Role.ANALYST).json()["code"]
        body = self.client.get(f"/api/workspaces/invite/{code}/").json()
        self.assertEqual(body["workspaceName"], "Belting")
        self.assertEqual(body["role"], Role.ANALYST)
        # The owner reading their own link is already in it.
        self.assertTrue(body["alreadyMember"])

    def test_a_spent_code_reads_as_unusable_rather_than_missing(self) -> None:
        code = self._post().json()["code"]
        joiner = User.objects.create_user(
            email="ketdi@b.uz", password="Parol12345", name="Ketdi", email_verified=True
        )
        client = APIClient()
        client.force_authenticate(joiner)
        client.post("/api/workspaces/join/", {"code": code}, format="json")

        body = self.client.get(f"/api/workspaces/invite/{code}/").json()
        self.assertFalse(body["usable"])

    def test_a_link_invite_names_nobody_and_anybody_may_redeem_it(self) -> None:
        """The addressed check must not catch the invite that has no address."""
        code = self._post().json()["code"]
        stranger = User.objects.create_user(
            email="begona@b.uz", password="Parol12345", name="Begona", email_verified=True
        )
        client = APIClient()
        client.force_authenticate(stranger)
        self.assertEqual(client.post("/api/workspaces/join/", {"code": code}, format="json").status_code, 201)

    def test_an_email_invite_is_not_a_bearer_code(self) -> None:
        """It was mailed to one person; anybody else holding it is not them.

        Before this the code was bearer: a forwarded mail handed a stranger the
        role, and the invited seat stayed held forever under an address now
        attached to somebody else's account.
        """
        self.client.post(
            "/api/workspaces/ws/members/",
            {"email": "jasur@b.uz", "role": Role.ADMIN},
            format="json",
            HTTP_X_WORKSPACE_ID="ws",
        )
        code = Invite.objects.get(email="jasur@b.uz").code

        stranger = User.objects.create_user(
            email="notjasur@b.uz", password="Parol12345", name="Begona", email_verified=True
        )
        client = APIClient()
        client.force_authenticate(stranger)
        response = client.post("/api/workspaces/join/", {"code": code}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "invite_not_yours")
        self.assertFalse(self.workspace.memberships.filter(user=stranger).exists())
        # And the person it was for is still able to use it.
        jasur = User.objects.create_user(
            email="jasur@b.uz", password="Parol12345", name="Jasur", email_verified=True
        )
        mine = APIClient()
        mine.force_authenticate(jasur)
        self.assertEqual(mine.post("/api/workspaces/join/", {"code": code}, format="json").status_code, 201)

    def test_an_editor_cannot_mint_one(self) -> None:
        editor = User.objects.create_user(
            email="muharrir@b.uz", password="Parol12345", name="Muharrir", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=editor, email=editor.email, role=Role.EDITOR
        )
        client = APIClient()
        client.force_authenticate(editor)
        response = client.post(
            "/api/workspaces/ws/invite-link/", {"role": Role.EDITOR}, format="json", HTTP_X_WORKSPACE_ID="ws"
        )
        self.assertEqual(response.status_code, 403)

    def test_nobody_hands_out_a_role_above_their_own(self) -> None:
        admin = User.objects.create_user(
            email="admin@b.uz", password="Parol12345", name="Admin", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=admin, email=admin.email, role=Role.ADMIN
        )
        client = APIClient()
        client.force_authenticate(admin)
        response = client.post(
            "/api/workspaces/ws/invite-link/", {"role": Role.OWNER}, format="json", HTTP_X_WORKSPACE_ID="ws"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "forbidden_role")


class MemberPermissionTests(TestCase):
    """Who may change whom — and what the workspace must never be left without."""

    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="ega@b.uz", password="Parol12345", name="Ega", email_verified=True
        )
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.owner)
        self.owner_m = Membership.objects.create(
            workspace=self.workspace, user=self.owner, email=self.owner.email, role=Role.OWNER
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _member(self, email: str, role: str) -> tuple[User, Membership]:
        user = User.objects.create_user(email=email, password="Parol12345", name=email, email_verified=True)
        membership = Membership.objects.create(
            workspace=self.workspace, user=user, email=email, role=role
        )
        return user, membership

    def _as(self, user) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_an_admin_cannot_demote_a_peer(self) -> None:
        """Equal rank is reaching across, not down. Whoever moved first used to win."""
        admin_a, _ = self._member("a@b.uz", Role.ADMIN)
        _, admin_b = self._member("b@b.uz", Role.ADMIN)

        response = self._as(admin_a).patch(f"/api/members/{admin_b.pk}/", {"role": Role.ANALYST}, format="json")
        self.assertEqual(response.status_code, 403)
        admin_b.refresh_from_db()
        self.assertEqual(admin_b.role, Role.ADMIN)

    def test_an_admin_cannot_remove_a_peer(self) -> None:
        admin_a, _ = self._member("a@b.uz", Role.ADMIN)
        _, admin_b = self._member("b@b.uz", Role.ADMIN)

        self.assertEqual(self._as(admin_a).delete(f"/api/members/{admin_b.pk}/").status_code, 403)
        self.assertTrue(Membership.objects.filter(pk=admin_b.pk).exists())

    def test_an_admin_still_manages_everyone_below(self) -> None:
        admin, _ = self._member("a@b.uz", Role.ADMIN)
        _, editor = self._member("m@b.uz", Role.EDITOR)

        self.assertEqual(
            self._as(admin).patch(f"/api/members/{editor.pk}/", {"role": Role.ANALYST}, format="json").status_code,
            200,
        )

    def test_the_last_owner_cannot_step_down(self) -> None:
        """Nobody left may delete the workspace, change the plan or promote anyone."""
        response = self.client.patch(f"/api/members/{self.owner_m.pk}/", {"role": Role.ANALYST}, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "last_owner")
        self.owner_m.refresh_from_db()
        self.assertEqual(self.owner_m.role, Role.OWNER)

    def test_ownership_can_still_be_handed_over(self) -> None:
        """Promote, then step down — the reason acting on yourself stays allowed."""
        _, admin = self._member("a@b.uz", Role.ADMIN)

        self.assertEqual(
            self.client.patch(f"/api/members/{admin.pk}/", {"role": Role.OWNER}, format="json").status_code, 200
        )
        self.assertEqual(
            self.client.patch(f"/api/members/{self.owner_m.pk}/", {"role": Role.EDITOR}, format="json").status_code,
            200,
        )
        self.assertEqual(self.workspace.memberships.filter(role=Role.OWNER).count(), 1)


class EmailVerificationGateTests(TestCase):
    """`User.email_verified` says the API refuses tenant data. Now it does.

    The only thing enforcing it was the interface's route guard, reading a
    base64 cookie any browser console can rewrite — so an unverified account
    could sign up and create real workspace data through the API.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            email="yangi@b.uz", password="Parol12345", name="Yangi", email_verified=False
        )
        self.workspace = Workspace.objects.create(id="ws", name="WS", slug="ws", owner=self.user)
        Membership.objects.create(
            workspace=self.workspace, user=self.user, email=self.user.email, role=Role.OWNER
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_an_unverified_account_cannot_read_tenant_data(self) -> None:
        response = self.client.get("/api/projects/", HTTP_X_WORKSPACE_ID="ws")
        self.assertEqual(response.status_code, 403)

    def test_an_unverified_account_cannot_write_either(self) -> None:
        response = self.client.post(
            "/api/projects/", {"name": "Loyiha"}, format="json", HTTP_X_WORKSPACE_ID="ws"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.workspace.projects.count(), 0)

    def test_verifying_opens_the_door(self) -> None:
        self.user.email_verified = True
        self.user.save(update_fields=["email_verified"])
        self.assertEqual(self.client.get("/api/projects/", HTTP_X_WORKSPACE_ID="ws").status_code, 200)

    def test_a_telegram_account_is_let_in_without_a_mailbox(self) -> None:
        """It has no real address to confirm; Telegram established the identity."""
        tg = User.objects.create_user(
            email="tg1@telegram.local", password=None, name="TG", email_verified=True, telegram_id=1
        )
        Membership.objects.create(workspace=self.workspace, user=tg, email=tg.email, role=Role.EDITOR)
        client = APIClient()
        client.force_authenticate(tg)
        self.assertEqual(client.get("/api/projects/", HTTP_X_WORKSPACE_ID="ws").status_code, 200)


class SeatLimitTests(TestCase):
    """The plan's `members` cap, on every path that can add somebody.

    The billing screen has always drawn `Jamoa a'zolari 2 / 2` on the Free
    plan while nothing refused the third, the tenth or the fiftieth — and the
    two halves were not even counting the same thing, so no number either of
    them showed was one the other would have agreed with.

    A seat is taken when it is *promised*, not when it is sat in. Both halves
    count `Membership` rows, invited ones included, for three reasons:

    - the refusal has to reach somebody who can act on it. Only an admin can
      raise the plan or free a seat; the invitee can do neither, and a 402 at
      the end of an invite link is a wall in front of the one person in the
      story who did nothing wrong;
    - a pending invite is a promise the workspace has already made. Left
      uncounted, a Free workspace can invite twenty people and read `2 / 2`
      throughout — the same lie, moved one table over;
    - the row already exists and is already on the team screen. A row a person
      can see in the list and the meter cannot see is exactly the disagreement
      `billing.services` is written to prevent.

    Freeing a promised seat is a real action, not a wait: DELETE
    `/api/members/<id>/` removes the pending row.
    """

    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="ega@b.uz", password="Parol12345", name="Ega", email_verified=True
        )
        self.workspace = Workspace.objects.create(
            id="ws", name="Belting", slug="ws", owner=self.owner, plan_key="start"
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.owner, email=self.owner.email, role=Role.OWNER
        )
        # The deployed entry plan, exactly as `seed_demo` writes it: two seats.
        self.plan = Plan.objects.create(
            key="start",
            name="Free",
            limits={"bots": 1, "flows": 5, "messages": 5000, "contacts": 1000, "members": 2, "aiBlocks": 0},
        )
        Subscription.objects.create(workspace=self.workspace, plan=self.plan)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _invite(self, email: str, role: str = Role.EDITOR):
        return self.client.post(
            "/api/workspaces/ws/members/",
            {"email": email, "role": role},
            format="json",
            HTTP_X_WORKSPACE_ID="ws",
        )

    def _link(self, role: str = Role.EDITOR):
        return self.client.post(
            "/api/workspaces/ws/invite-link/", {"role": role}, format="json", HTTP_X_WORKSPACE_ID="ws"
        )

    def _joiner(self, email: str) -> APIClient:
        user = User.objects.create_user(email=email, password="Parol12345", name=email, email_verified=True)
        client = APIClient()
        client.force_authenticate(user)
        return client

    # -- the seat the plan does allow --------------------------------------

    def test_the_second_seat_is_still_invitable(self):
        self.assertEqual(self._invite("ikki@b.uz").status_code, 201)

    # -- and the one it does not -------------------------------------------

    def test_a_third_member_cannot_be_invited_by_email(self):
        self._invite("ikki@b.uz")

        response = self._invite("uch@b.uz")

        self.assertEqual(response.status_code, 402, response.data)
        body = response.json()["error"]
        self.assertEqual(body["code"], "plan_limit")
        self.assertIn("Free", body["message"])
        self.assertEqual(body["field"], "email")
        self.assertFalse(
            self.workspace.memberships.filter(email="uch@b.uz").exists(), "refused before the write"
        )
        self.assertFalse(Invite.objects.filter(email="uch@b.uz").exists(), "and no code was minted")

    def test_a_pending_invite_holds_the_seat_it_was_sent_for(self):
        """Otherwise the cap is only a cap on people who answered their mail."""
        self._invite("ikki@b.uz")
        self.assertTrue(self.workspace.memberships.get(email="ikki@b.uz").invited)

        self.assertEqual(self._invite("uch@b.uz").status_code, 402)

    def test_an_invite_link_is_refused_when_no_seat_is_free(self):
        self._invite("ikki@b.uz")

        response = self._link()

        self.assertEqual(response.status_code, 402, response.data)
        self.assertEqual(response.json()["error"]["code"], "plan_limit")
        # A link invite is the one that names nobody; the email invite above
        # minted a code of its own.
        self.assertFalse(Invite.objects.filter(email="").exists(), "a link nobody could redeem is not minted")

    def test_the_invite_that_held_the_seat_can_still_be_redeemed(self):
        """The seat was counted when it was promised; keeping the promise costs nothing."""
        code = Invite.objects.get(email=self._invite("ikki@b.uz").json()["invite"]["email"]).code

        response = self._joiner("ikki@b.uz").post("/api/workspaces/join/", {"code": code}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(self.workspace.memberships.get(email="ikki@b.uz").invited)
        self.assertEqual(self.workspace.memberships.count(), 2)

    def test_a_link_redeemed_after_the_seat_went_is_refused(self):
        """A link holds no seat, so the last check has to be at the door."""
        code = self._link().json()["code"]
        self._invite("ikki@b.uz")  # the free seat, taken while the link was travelling

        response = self._joiner("uch@b.uz").post("/api/workspaces/join/", {"code": code}, format="json")

        self.assertEqual(response.status_code, 402, response.data)
        self.assertEqual(response.json()["error"]["code"], "plan_limit")
        self.assertFalse(self.workspace.memberships.filter(email="uch@b.uz").exists())
        self.assertTrue(Invite.objects.get(code=code).is_usable, "a refused code is not a spent one")

    def test_freeing_a_promised_seat_makes_it_invitable_again(self):
        pending = self._invite("ikki@b.uz").json()["member"]["id"]
        self.assertEqual(self._invite("uch@b.uz").status_code, 402)

        self.assertEqual(self.client.delete(f"/api/members/{pending}/").status_code, 204)

        self.assertEqual(self._invite("uch@b.uz").status_code, 201)

    def test_an_uncapped_plan_invites_as_many_as_it_likes(self):
        self.plan.limits = {**self.plan.limits, "members": None}
        self.plan.save(update_fields=["limits"])

        for email in ("ikki@b.uz", "uch@b.uz", "tort@b.uz"):
            self.assertEqual(self._invite(email).status_code, 201, email)

    # -- and the number the screen shows -----------------------------------

    def test_the_gauge_counts_the_seat_the_invite_holds(self):
        """The gauge and the guard have to be looking at the same number."""
        self._invite("ikki@b.uz")

        rows = {row["key"]: row for row in usage_report(self.workspace)["metrics"]}

        self.assertEqual(rows["members"]["used"], 2)
        self.assertEqual(rows["members"]["limit"], 2)


class WorkspaceFieldGuardTests(TestCase):
    """What `PATCH /api/workspaces/<id>/` is and is not allowed to write.

    The endpoint exists for the two fields on the settings form. It was built
    from `WorkspaceSerializer`, which was built from the model, so it inherited
    every column the model happens to expose — and two of those turned out to
    be answers to questions this form was never asking.
    """

    def setUp(self) -> None:
        self.owner = User.objects.create_user(
            email="ega@b.uz", password="Parol12345", name="Ega", email_verified=True
        )
        self.workspace = Workspace.objects.create(
            id="ws", name="Belting", slug="ws", owner=self.owner, plan_key="start"
        )
        Membership.objects.create(
            workspace=self.workspace, user=self.owner, email=self.owner.email, role=Role.OWNER
        )
        Plan.objects.create(key="start", name="Free", limits={"bots": 1, "members": 2})
        Plan.objects.create(key="pro", name="Pro", limits={"bots": 50, "members": 50})
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _patch(self, body: dict):
        return self.client.patch("/api/workspaces/ws/", body, format="json", HTTP_X_WORKSPACE_ID="ws")

    # -- the plan ----------------------------------------------------------

    def test_the_settings_form_cannot_hand_the_workspace_a_better_plan(self):
        """The one door onto the plan is `POST /api/billing/subscription/`, and
        it is owner-only for a reason: the plan is what the workspace pays for.

        This was the second door and it was not guarded at all. `planKey` was a
        writable field on the workspace serializer, `perform_update` asks only
        for a write role, and `plan_for` falls back to `Workspace.plan_key`
        whenever there is no `Subscription` row — which is every workspace that
        has never bought anything, i.e. every new one. So a `PATCH` carrying
        one extra key raised every limit in `apps.billing.services` for free,
        and the billing screen went on reporting the plan it had been given.
        """
        response = self._patch({"name": "Belting", "planKey": "pro"})

        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.plan_key, "start", "the plan is not a settings field")
        self.assertEqual(response.data["planKey"], "start")
        self.assertEqual(self.workspace.name, "Belting", "and the rest of the patch still applied")

    def test_an_editor_cannot_reach_it_either(self):
        """The role check above `perform_update` is `WRITE_ROLES`, which
        includes every editor in the workspace — three ranks below the owner
        the billing endpoint insists on."""
        editor = User.objects.create_user(
            email="muharrir@b.uz", password="Parol12345", name="Muharrir", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=editor, email=editor.email, role=Role.EDITOR
        )
        client = APIClient()
        client.force_authenticate(editor)

        client.patch("/api/workspaces/ws/", {"planKey": "pro"}, format="json", HTTP_X_WORKSPACE_ID="ws")

        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.plan_key, "start")

    # -- the timezone ------------------------------------------------------

    def test_a_zone_nothing_can_read_is_refused_at_the_door(self):
        """`timezone` is not a label. Two things read it and both of them are
        `ZoneInfo(...)` calls that fall back to UTC when the string is not a
        zone — `analytics.services.workspace_zone` and
        `engine.matching._within_schedule` — so a stored typo does not fail, it
        silently moves every schedule trigger and every report five hours.

        The screen offers a `<select>` of five zones, so nothing a person can
        press produces this. The API accepted any sixty-four characters, which
        is the same shape of hole `InterfaceLocale` closed for `locale`: the
        picker was never the rule, it only looked like one.
        """
        response = self._patch({"timezone": "Mars/Olympus"})

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.json()["error"]["field"], "timezone")
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.timezone, "Asia/Tashkent")

    def test_a_real_zone_still_goes_through(self):
        self.assertEqual(self._patch({"timezone": "Europe/Istanbul"}).status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.timezone, "Europe/Istanbul")

    def test_a_new_workspace_is_held_to_the_same_zone_rule(self):
        """The create path builds its own serializer, so the rule has to be on
        both or the hole simply moves to signup."""
        response = self.client.post(
            "/api/workspaces/", {"name": "Yangi", "timezone": "Mars/Olympus"}, format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Workspace.objects.filter(name="Yangi").exists())

    # -- the language the reports are formatted in -------------------------

    def test_the_reports_locale_is_a_settings_field_and_is_checked(self):
        """`Workspace.locale` has exactly one reader — the analytics screen's
        number and date formatting — and until now no way to change it after
        the workspace was created. It is on the form now, so it is worth
        pinning that the model's `choices` actually close the field."""
        self.assertEqual(self._patch({"locale": "ru-RU"}).status_code, 200)
        self.workspace.refresh_from_db()
        self.assertEqual(self.workspace.locale, "ru-RU")

        self.assertEqual(self._patch({"locale": "kl-KL"}).status_code, 400)
