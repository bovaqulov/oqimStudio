"""Table API tests — the price list a bot quotes from, and the door into it.

Two things are worth more than the CRUD here, and they are the two that would
be silent if they broke: that one workspace cannot reach another's rows, and
that the open webhook writes to exactly the table its secret names.
"""

from __future__ import annotations

from unittest import skipUnless

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.bots.models import Bot
from apps.projects.models import Project
from apps.tables.models import Table, TableRow
from apps.workspaces.models import Membership, Role, Workspace

COLUMNS = [
    {"key": "xizmat", "label": "Xizmat", "type": "text"},
    {"key": "narx", "label": "Narx", "type": "number"},
]


def script_available() -> bool:
    from apps.engine.script import is_available

    return is_available()


def a_workspace(email: str, workspace_id: str) -> tuple[User, Workspace]:
    user = User.objects.create_user(email=email, password="Parol12345", name="A", email_verified=True)
    workspace = Workspace.objects.create(id=workspace_id, name=workspace_id, slug=workspace_id, owner=user)
    Membership.objects.create(workspace=workspace, user=user, email=user.email, role=Role.OWNER)
    return user, workspace


class TableApiTests(TestCase):
    def setUp(self) -> None:
        # Throttle counters live in the cache and outlive a test method.
        cache.clear()
        self.user, self.workspace = a_workspace("a@b.uz", "ws")
        self.project = Project.objects.create(id="p", workspace=self.workspace, name="P", handle="p")
        self.bot = Bot.objects.create(
            id="b", workspace=self.workspace, project=self.project, handle="@b", token="t", enabled_modules=["dms"]
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create(self, **payload):
        body = {"name": "Narxlar", "handle": "narxlar", "columns": COLUMNS, **payload}
        return self.client.post("/api/tables/", body)

    def test_creating_one_returns_the_shape_the_studio_reads(self):
        response = self.create(botId=self.bot.id)

        self.assertEqual(response.status_code, 201, response.data)
        body = response.data
        self.assertEqual(body["name"], "Narxlar")
        self.assertEqual(body["handle"], "narxlar")
        self.assertEqual(body["botId"], self.bot.id)
        self.assertEqual(body["columns"], COLUMNS)
        self.assertEqual(body["rowCount"], 0)
        self.assertIn("/api/tables/hook/", body["webhookUrl"], "the address an integration is given")

    def test_a_table_without_a_bot_belongs_to_the_whole_workspace(self):
        body = self.create().data

        self.assertIsNone(body["botId"], "a price list outlives the bot that quoted it")

    def test_the_handle_is_derived_when_nobody_supplied_one(self):
        body = self.client.post("/api/tables/", {"name": "Kunlik navbat", "columns": []}).data

        self.assertEqual(body["handle"], "kunlik_navbat", "«-» cannot be written in {{ }}")

    def test_a_second_derived_handle_does_not_collide_with_the_first(self):
        first = self.client.post("/api/tables/", {"name": "Navbat", "columns": []}).data["handle"]
        second = self.client.post("/api/tables/", {"name": "Navbat", "columns": []}).data["handle"]

        self.assertEqual(first, "navbat")
        self.assertNotEqual(first, second)

    def test_a_handle_nothing_can_spell_is_refused(self):
        response = self.client.post("/api/tables/", {"name": "X", "handle": "Narx Ro'yxati", "columns": []})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_handle")
        self.assertEqual(response.data["error"]["field"], "handle")

    def test_the_same_handle_twice_in_one_workspace_is_refused(self):
        self.create()

        response = self.create(name="Boshqa")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "handle_taken")

    def test_the_same_handle_in_another_workspace_is_fine(self):
        self.create()
        outsider, _ = a_workspace("c@b.uz", "ws2")
        client = APIClient()
        client.force_authenticate(outsider)

        response = client.post("/api/tables/", {"name": "Narxlar", "handle": "narxlar", "columns": COLUMNS})

        self.assertEqual(response.status_code, 201, "two companies may both call their price list narxlar")

    def test_a_column_type_nothing_knows_about_is_refused(self):
        response = self.client.post(
            "/api/tables/",
            {"name": "X", "handle": "x_jadval", "columns": [{"key": "narx", "type": "money"}]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_column_type")

    def test_a_column_without_a_label_is_headed_by_its_key(self):
        body = self.client.post(
            "/api/tables/", {"name": "X", "handle": "x_jadval", "columns": [{"key": "narx"}]}
        ).data

        self.assertEqual(body["columns"], [{"key": "narx", "label": "narx", "type": "text"}])

    def test_the_same_column_key_twice_is_refused(self):
        response = self.client.post(
            "/api/tables/",
            {"name": "X", "handle": "x_jadval", "columns": [{"key": "narx"}, {"key": "narx"}]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "duplicate_column_key")

    def test_a_patch_renames_it_and_adds_a_column(self):
        table_id = self.create().data["id"]

        response = self.client.patch(
            f"/api/tables/{table_id}/",
            {"name": "Yangi narxlar", "columns": [*COLUMNS, {"key": "faol", "label": "Faol", "type": "bool"}]},
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["name"], "Yangi narxlar")
        self.assertEqual(len(response.data["columns"]), 3)

    def test_keeping_its_own_handle_through_a_patch_is_not_a_clash_with_itself(self):
        table_id = self.create().data["id"]

        response = self.client.patch(f"/api/tables/{table_id}/", {"handle": "narxlar"})

        self.assertEqual(response.status_code, 200, response.data)

    def test_deleting_it_takes_its_rows_with_it(self):
        table_id = self.create().data["id"]
        self.client.post(f"/api/tables/{table_id}/rows/", {"data": {"xizmat": "Konsultatsiya", "narx": 100}})

        self.assertEqual(self.client.delete(f"/api/tables/{table_id}/").status_code, 204)
        self.assertEqual(TableRow.objects.count(), 0)

    def test_a_bot_from_another_workspace_cannot_be_named(self):
        _, other_ws = a_workspace("c@b.uz", "ws2")
        other_project = Project.objects.create(id="p2", workspace=other_ws, name="P2", handle="p2")
        stranger = Bot.objects.create(
            id="b2", workspace=other_ws, project=other_project, handle="@b2", token="t", enabled_modules=["dms"]
        )

        response = self.create(botId=stranger.id)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "bot_not_found")
        self.assertEqual(Table.objects.count(), 0)

    def test_the_list_can_be_narrowed_to_one_bot(self):
        self.create(botId=self.bot.id)
        self.client.post("/api/tables/", {"name": "Umumiy", "handle": "umumiy", "columns": []})

        self.assertEqual(self.client.get("/api/tables/").data["count"], 2)
        self.assertEqual(self.client.get("/api/tables/", {"botId": self.bot.id}).data["count"], 1)


class TableRowApiTests(TestCase):
    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("a@b.uz", "ws")
        self.table = Table.objects.create(
            id="t", workspace=self.workspace, name="Narxlar", handle="narxlar", columns=COLUMNS
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def add(self, data):
        return self.client.post(f"/api/tables/{self.table.id}/rows/", {"data": data})

    def test_a_row_comes_back_keyed_by_column(self):
        response = self.add({"xizmat": "Konsultatsiya", "narx": 150000})

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["tableId"], self.table.id)
        self.assertEqual(response.data["data"], {"xizmat": "Konsultatsiya", "narx": 150000})

    def test_a_key_the_table_does_not_have_is_dropped_and_not_refused(self):
        response = self.add({"xizmat": "Konsultatsiya", "eskirgan": "x"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["data"], {"xizmat": "Konsultatsiya"})

    def test_a_number_column_refuses_what_is_not_a_number(self):
        response = self.add({"narx": "arzon"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_number")
        self.assertEqual(response.data["error"]["field"], "narx")

    def test_a_number_written_as_a_string_is_stored_as_a_number(self):
        # What every integration that reads a spreadsheet actually sends.
        self.assertEqual(self.add({"narx": "150000"}).data["data"]["narx"], 150000)

    def test_a_body_without_a_data_object_is_refused(self):
        response = self.client.post(f"/api/tables/{self.table.id}/rows/", {"narx": 1})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_row")

    def test_the_list_is_newest_first_and_paginated(self):
        for index in range(3):
            self.add({"xizmat": f"X{index}"})

        body = self.client.get(f"/api/tables/{self.table.id}/rows/", {"limit": 2}).data

        self.assertEqual(body["count"], 3)
        self.assertEqual(len(body["results"]), 2)
        self.assertEqual(body["results"][0]["data"]["xizmat"], "X2", "newest first")

    def test_a_patch_replaces_the_row_whole(self):
        row_id = self.add({"xizmat": "Konsultatsiya", "narx": 100}).data["id"]

        response = self.client.patch(
            f"/api/tables/{self.table.id}/rows/{row_id}/", {"data": {"xizmat": "Tekshiruv"}}
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"], {"xizmat": "Tekshiruv"}, "a cleared cell is a key that is gone")

    def test_a_row_is_deleted(self):
        row_id = self.add({"xizmat": "Konsultatsiya"}).data["id"]

        self.assertEqual(self.client.delete(f"/api/tables/{self.table.id}/rows/{row_id}/").status_code, 204)
        self.assertEqual(TableRow.objects.count(), 0)

    def test_the_row_count_is_what_the_card_shows(self):
        self.add({"xizmat": "Konsultatsiya"})

        self.assertEqual(self.client.get("/api/tables/").data["results"][0]["rowCount"], 1)


class TableTenancyTests(TestCase):
    """The isolation, stated as the three ways somebody would try to cross it."""

    def setUp(self) -> None:
        cache.clear()
        owner, self.workspace = a_workspace("a@b.uz", "ws")
        self.table = Table.objects.create(
            id="t", workspace=self.workspace, name="Narxlar", handle="narxlar", columns=COLUMNS
        )
        self.row = TableRow.objects.create(table=self.table, data={"xizmat": "Konsultatsiya"})

        self.outsider, _ = a_workspace("c@b.uz", "ws2")
        self.client = APIClient()
        self.client.force_authenticate(self.outsider)

    def test_another_workspace_sees_none_of_it(self):
        self.assertEqual(self.client.get("/api/tables/").data["count"], 0)

    def test_another_workspace_cannot_open_it_by_id(self):
        self.assertEqual(self.client.get(f"/api/tables/{self.table.id}/").status_code, 404)

    def test_another_workspace_cannot_read_its_rows_by_id(self):
        self.assertEqual(self.client.get(f"/api/tables/{self.table.id}/rows/").status_code, 404)

    def test_another_workspace_cannot_write_a_row_into_it(self):
        response = self.client.post(f"/api/tables/{self.table.id}/rows/", {"data": {"xizmat": "X"}})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(TableRow.objects.count(), 1)

    def test_signing_out_closes_the_whole_surface(self):
        client = APIClient()

        # 403 and not 401: `SessionAuthentication` offers no challenge header,
        # so DRF answers "forbidden" — the same answer every other tenant
        # surface in this codebase gives an anonymous caller.
        self.assertEqual(client.get("/api/tables/").status_code, 403)

    def test_an_analyst_reads_but_does_not_write(self):
        analyst = User.objects.create_user(
            email="d@b.uz", password="Parol12345", name="D", email_verified=True
        )
        Membership.objects.create(
            workspace=self.workspace, user=analyst, email=analyst.email, role=Role.ANALYST
        )
        client = APIClient()
        client.force_authenticate(analyst)

        self.assertEqual(client.get(f"/api/tables/{self.table.id}/rows/").status_code, 200)
        self.assertEqual(client.post(f"/api/tables/{self.table.id}/rows/", {"data": {}}).status_code, 403)


class TableHookTests(TestCase):
    """The open endpoint — the only way into this app without an account."""

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("a@b.uz", "ws")
        self.table = Table.objects.create(
            id="t", workspace=self.workspace, name="Narxlar", handle="narxlar", columns=COLUMNS
        )
        # No credential of any kind: this is the client an integration is.
        self.client = APIClient()

    def url(self, secret: str | None = None) -> str:
        return f"/api/tables/hook/{secret or self.table.webhook_secret}/"

    def test_the_secret_is_enough_to_append_a_row(self):
        response = self.client.post(self.url(), {"data": {"xizmat": "Konsultatsiya", "narx": "150000"}})

        self.assertEqual(response.status_code, 201, response.data)
        row = TableRow.objects.get()
        self.assertEqual(row.table_id, self.table.id)
        self.assertEqual(row.data, {"xizmat": "Konsultatsiya", "narx": 150000})

    def test_a_secret_nobody_issued_is_a_404_that_says_nothing(self):
        response = self.client.post(self.url("qalbaki"), {"data": {"xizmat": "X"}})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "table_not_found")
        self.assertEqual(TableRow.objects.count(), 0)

    def test_a_body_without_a_data_object_is_refused(self):
        response = self.client.post(self.url(), {"data": "Konsultatsiya"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_row")
        self.assertEqual(response.data["error"]["field"], "data")

    def test_a_number_column_refuses_what_is_not_a_number(self):
        response = self.client.post(self.url(), {"data": {"narx": "arzon"}})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(TableRow.objects.count(), 0)

    def test_rotating_the_secret_retires_the_url_that_leaked(self):
        old = self.table.webhook_secret
        client = APIClient()
        client.force_authenticate(self.user)

        response = client.post(f"/api/tables/{self.table.id}/rotate-secret/")

        self.assertEqual(response.status_code, 200, response.data)
        self.table.refresh_from_db()
        self.assertNotEqual(self.table.webhook_secret, old)
        self.assertIn(self.table.webhook_secret, response.data["webhookUrl"])
        self.assertEqual(self.client.post(self.url(old), {"data": {"xizmat": "X"}}).status_code, 404)

    def test_the_url_follows_the_public_address_rather_than_a_stored_copy(self):
        client = APIClient()
        client.force_authenticate(self.user)

        with self.settings(PUBLIC_BASE_URL="https://yangi-manzil.example"):
            body = client.get(f"/api/tables/{self.table.id}/").data

        self.assertEqual(body["webhookUrl"], f"https://yangi-manzil.example/api/tables/hook/{self.table.webhook_secret}/")

    def test_the_open_endpoint_has_a_ceiling(self):
        # Sixty a minute — the throttle exists so that guessing a secret is
        # bounded by something other than the width of the secret.
        for _ in range(60):
            self.client.post(self.url(), {"data": {"xizmat": "X"}})

        response = self.client.post(self.url(), {"data": {"xizmat": "X"}})

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["error"]["code"], "rate_limited")


class SelectColumnTests(TestCase):
    """A column whose value has to be one of a list the author wrote."""

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("s@b.uz", "sel")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.table = self._table(
            [{"key": "holat", "label": "Holat", "type": "select", "options": ["Yangi", "Bajarildi", "Bekor"]}]
        )

    def _table(self, columns):
        response = self.client.post(
            "/api/tables/", {"name": "Navbat", "columns": columns}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def _row(self, value):
        return self.client.post(
            f"/api/tables/{self.table['id']}/rows/", {"data": {"holat": value}}, format="json"
        )

    def test_the_choices_are_stored_on_the_column(self):
        self.assertEqual(self.table["columns"][0]["options"], ["Yangi", "Bajarildi", "Bekor"])

    def test_a_listed_choice_is_accepted(self):
        response = self._row("Bajarildi")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["data"]["holat"], "Bajarildi")

    def test_a_value_outside_the_list_is_refused_and_says_what_is_allowed(self):
        response = self._row("Boshqa")

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "invalid_choice")
        self.assertIn("Yangi", response.data["error"]["message"])

    def test_an_empty_cell_is_still_empty(self):
        """No answer is not a wrong answer — the column may simply be unfilled."""
        response = self._row("")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["data"]["holat"])

    def test_a_column_with_no_choices_yet_accepts_anything(self):
        """Switching a column to «select» before typing its list must not lock it."""
        table = self._table([{"key": "turi", "label": "Turi", "type": "select"}])

        response = self.client.post(
            f"/api/tables/{table['id']}/rows/", {"data": {"turi": "istalgan"}}, format="json"
        )

        self.assertEqual(response.status_code, 201, response.data)

    def test_blank_and_repeated_choices_are_dropped(self):
        table = self._table(
            [{"key": "a1", "label": "A", "type": "select", "options": ["Bir", "", "  ", "Bir", "Ikki"]}]
        )

        self.assertEqual(table["columns"][0]["options"], ["Bir", "Ikki"])


class RefColumnTests(TestCase):
    """A column pointing at a row in another table."""

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("r@b.uz", "refws")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        self.staff = self._table("Shifokorlar", [{"key": "ism", "label": "Ism", "type": "text"}])
        self.doctor = self._row(self.staff, {"ism": "Aziz"})
        self.services = self._table(
            "Xizmatlar",
            [
                {"key": "nomi", "label": "Nomi", "type": "text"},
                {
                    "key": "shifokor",
                    "label": "Shifokor",
                    "type": "ref",
                    "refTable": "shifokorlar",
                    "refColumn": "ism",
                },
            ],
        )

    def _table(self, name, columns):
        response = self.client.post("/api/tables/", {"name": name, "columns": columns}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def _row(self, table, data):
        response = self.client.post(f"/api/tables/{table['id']}/rows/", {"data": data}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_the_target_travels_on_the_column(self):
        column = self.services["columns"][1]
        self.assertEqual(column["refTable"], "shifokorlar")
        self.assertEqual(column["refColumn"], "ism")

    def test_a_real_row_id_is_accepted_and_stored_as_the_id(self):
        row = self._row(self.services, {"nomi": "MRT", "shifokor": self.doctor["id"]})

        self.assertEqual(row["data"]["shifokor"], self.doctor["id"])

    def test_an_id_that_names_nothing_is_refused(self):
        response = self.client.post(
            f"/api/tables/{self.services['id']}/rows/",
            {"data": {"nomi": "MRT", "shifokor": "yoq-bunday-id"}},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "invalid_ref")

    def test_a_reader_gets_the_name_and_not_the_id(self):
        """`{{qator.shifokor}}` has to reach a customer as «Aziz»."""
        from apps.tables.models import Table
        from apps.tables.services import expand_refs

        self._row(self.services, {"nomi": "MRT", "shifokor": self.doctor["id"]})
        table = Table.objects.get(pk=self.services["id"])

        shown = expand_refs(table, [row for row in table.rows.values_list("data", flat=True)])

        self.assertEqual(shown[0]["shifokor"], "Aziz")

    def test_a_reference_whose_row_was_deleted_reads_as_empty(self):
        from apps.tables.models import Table, TableRow
        from apps.tables.services import expand_refs

        self._row(self.services, {"nomi": "MRT", "shifokor": self.doctor["id"]})
        TableRow.objects.filter(pk=self.doctor["id"]).delete()
        table = Table.objects.get(pk=self.services["id"])

        shown = expand_refs(table, [row for row in table.rows.values_list("data", flat=True)])

        # A gap, not a hex string the reader can do nothing with.
        self.assertEqual(shown[0]["shifokor"], "")


class RowSearchTests(TestCase):
    """Finding a row, and putting the rows in an order — both in the database."""

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("q@b.uz", "qws")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/tables/",
            {
                "name": "Narxlar",
                "columns": [
                    {"key": "nomi", "label": "Nomi", "type": "text"},
                    {"key": "narxi", "label": "Narxi", "type": "number"},
                ],
            },
            format="json",
        )
        self.table = response.data
        for nomi, narxi in [("MRT", 150000), ("UZI", 90000), ("Qon tahlili", 60000)]:
            self.client.post(
                f"/api/tables/{self.table['id']}/rows/", {"data": {"nomi": nomi, "narxi": narxi}}, format="json"
            )

    def _names(self, params=None):
        response = self.client.get(f"/api/tables/{self.table['id']}/rows/", params or {})
        self.assertEqual(response.status_code, 200, response.data)
        return [row["data"]["nomi"] for row in response.data["results"]]

    def test_it_finds_a_row_by_any_of_its_values(self):
        self.assertEqual(self._names({"q": "UZI"}), ["UZI"])

    def test_the_search_does_not_care_about_case(self):
        self.assertEqual(self._names({"q": "mrt"}), ["MRT"])

    def test_nothing_found_is_an_empty_page_and_not_an_error(self):
        self.assertEqual(self._names({"q": "yoq"}), [])

    def test_it_sorts_by_a_column(self):
        self.assertEqual(self._names({"sort": "nomi"}), ["MRT", "Qon tahlili", "UZI"])

    def test_it_sorts_the_other_way(self):
        self.assertEqual(self._names({"sort": "-nomi"}), ["UZI", "Qon tahlili", "MRT"])

    def test_a_column_the_table_does_not_have_is_ignored(self):
        """A key out of the address bar is a caller's string, not a query."""
        self.assertEqual(len(self._names({"sort": "yoq_bunday"})), 3)

    def test_search_and_sort_work_together(self):
        self.assertEqual(self._names({"q": "0", "sort": "nomi"}), ["MRT", "Qon tahlili", "UZI"])


@skipUnless(script_available(), "node topilmadi — skript muhiti yo'q")
class FormulaColumnTests(TestCase):
    """A column worked out from the others rather than stored."""

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("f@b.uz", "fws")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.table = self.client.post(
            "/api/tables/",
            {
                "name": "Narxlar",
                "columns": [
                    {"key": "narx", "label": "Narx", "type": "number"},
                    {"key": "soni", "label": "Soni", "type": "number"},
                    {"key": "jami", "label": "Jami", "type": "formula", "formula": "narx * soni"},
                ],
            },
            format="json",
        ).data

    def _rows(self):
        return self.client.get(f"/api/tables/{self.table['id']}/rows/").data["results"]

    def test_the_formula_travels_on_the_column(self):
        self.assertEqual(self.table["columns"][2]["formula"], "narx * soni")

    def test_it_is_worked_out_when_the_row_is_read(self):
        self.client.post(
            f"/api/tables/{self.table['id']}/rows/", {"data": {"narx": 1000, "soni": 3}}, format="json"
        )

        self.assertEqual(self._rows()[0]["data"]["jami"], 3000)

    def test_it_is_never_stored(self):
        """A computed value kept on disk is a copy that stops agreeing."""
        from apps.tables.models import TableRow

        self.client.post(
            f"/api/tables/{self.table['id']}/rows/", {"data": {"narx": 1000, "soni": 3, "jami": 999}}, format="json"
        )

        stored = TableRow.objects.get(table_id=self.table["id"]).data
        self.assertNotIn("jami", stored)

    def test_it_follows_its_inputs(self):
        row = self.client.post(
            f"/api/tables/{self.table['id']}/rows/", {"data": {"narx": 1000, "soni": 3}}, format="json"
        ).data
        self.client.patch(
            f"/api/tables/{self.table['id']}/rows/{row['id']}/",
            {"data": {"narx": 2000, "soni": 3}},
            format="json",
        )

        self.assertEqual(self._rows()[0]["data"]["jami"], 6000)

    def test_a_formula_that_throws_leaves_its_cell_empty(self):
        table = self.client.post(
            "/api/tables/",
            {
                "name": "Buzuq",
                "columns": [
                    {"key": "narx", "label": "Narx", "type": "number"},
                    {"key": "x1", "label": "X", "type": "formula", "formula": "yoq.bunday.narsa"},
                ],
            },
            format="json",
        ).data
        self.client.post(f"/api/tables/{table['id']}/rows/", {"data": {"narx": 5}}, format="json")

        rows = self.client.get(f"/api/tables/{table['id']}/rows/").data["results"]

        # The row still opens, and the column somebody is still writing is blank.
        self.assertIsNone(rows[0]["data"]["x1"])
        self.assertEqual(rows[0]["data"]["narx"], 5)


class ColumnShapeRoundTripTests(TestCase):
    """A column comes back with the half of it that its type is *for*.

    `type` alone is not a column. A `select` is its `options`, a `formula` is
    its `formula`, and a `ref` is the table it points at — and each of those
    lives on the column rather than in a second table precisely so it travels
    with it.

    Every test here reads the shape back through a fresh GET rather than off the
    response to the write, because that is the request the studio actually
    draws from and it is the one that was wrong: the panel rebuilt each column
    as `{key, label, type}` in both directions, so a select column arrived with
    an empty choices box and a formula column with an empty expression, however
    faithfully these fields had been stored. The types were right, so nothing
    looked broken; the two column types were simply inert. Reading the write's
    own answer would have passed while that was true.

    The second thing pinned here is the control experiment that found it: a
    PATCH that changes only a heading must not cost the column anything else.
    """

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("c@b.uz", "colws")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.shifokorlar = self.client.post(
            "/api/tables/",
            {"name": "Shifokorlar", "handle": "shifokorlar", "columns": [{"key": "ism", "label": "Ism"}]},
            format="json",
        ).data
        self.table = self.client.post(
            "/api/tables/",
            {
                "name": "Qabul",
                "handle": "qabul",
                "columns": [
                    {"key": "nomi", "label": "Nomi", "type": "text"},
                    {
                        "key": "mutaxassisligi",
                        "label": "Mutaxassisligi",
                        "type": "select",
                        "options": ["Terapevt", "Stomatolog", "Kardiolog"],
                    },
                    {"key": "narx", "label": "Narx", "type": "number"},
                    {"key": "soni", "label": "Soni", "type": "number"},
                    {"key": "hisob", "label": "Hisob", "type": "formula", "formula": "narx * soni"},
                    {
                        "key": "shifokor",
                        "label": "Shifokor",
                        "type": "ref",
                        "refTable": "shifokorlar",
                        "refColumn": "ism",
                    },
                ],
            },
            format="json",
        ).data

    def read(self) -> list[dict]:
        """The columns as a fresh reader of this table gets them."""
        response = self.client.get(f"/api/tables/{self.table['id']}/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["columns"]

    def by_key(self, key: str) -> dict:
        return next(column for column in self.read() if column["key"] == key)

    def test_a_select_column_is_read_back_with_its_choices(self):
        self.assertEqual(
            self.by_key("mutaxassisligi")["options"], ["Terapevt", "Stomatolog", "Kardiolog"]
        )

    def test_a_formula_column_is_read_back_with_its_expression(self):
        self.assertEqual(self.by_key("hisob")["formula"], "narx * soni")

    def test_a_ref_column_is_read_back_still_pointing_somewhere(self):
        column = self.by_key("shifokor")
        self.assertEqual(column["refTable"], "shifokorlar")
        self.assertEqual(column["refColumn"], "ism")

    def test_the_list_carries_the_same_shape_as_the_detail(self):
        """The studio's table list draws column editors from this one too."""
        listed = next(
            item
            for item in self.client.get("/api/tables/").data["results"]
            if item["id"] == self.table["id"]
        )

        self.assertEqual(listed["columns"], self.read())

    def test_renaming_a_heading_costs_the_column_nothing_else(self):
        """The experiment that found the defect: «Nomi» → «FIO», everything else intact.

        A rename is the commonest edit this screen sees and it goes out as the
        whole column list, so a caller that could not carry `options` and
        `formula` would wipe both on a change that had nothing to do with
        either — silently, and looking for all the world like a save that
        simply had not worked.
        """
        columns = self.read()
        columns[0]["label"] = "FIO"

        response = self.client.patch(
            f"/api/tables/{self.table['id']}/", {"columns": columns}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        after = self.read()
        self.assertEqual(after[0]["label"], "FIO")
        self.assertEqual(after[1]["options"], ["Terapevt", "Stomatolog", "Kardiolog"])
        self.assertEqual(after[4]["formula"], "narx * soni")
        self.assertEqual(after[5]["refTable"], "shifokorlar")

    def test_a_rename_leaves_the_key_alone(self):
        """And the reason the help text now says so.

        The key is what every stored row is filed under and what every flow
        expression and incoming webhook already names. A heading that dragged it
        along would empty the column in every row already written and break the
        integrations in the same instant.
        """
        columns = self.read()
        columns[0]["label"] = "FIO"
        self.client.patch(f"/api/tables/{self.table['id']}/", {"columns": columns}, format="json")

        self.assertEqual(self.read()[0]["key"], "nomi")

    def test_a_choice_outside_the_list_is_refused_on_a_correction_too(self):
        """Not only on the way in — the grid edits a cell with a PATCH."""
        row = self.client.post(
            f"/api/tables/{self.table['id']}/rows/",
            {"data": {"mutaxassisligi": "Terapevt"}},
            format="json",
        ).data

        response = self.client.patch(
            f"/api/tables/{self.table['id']}/rows/{row['id']}/",
            {"data": {"mutaxassisligi": "Kosmonavt"}},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "invalid_choice")
        self.assertEqual(response.data["error"]["field"], "mutaxassisligi")

    def test_a_computed_cell_is_dropped_on_a_correction_too(self):
        """A number typed into «Hisob» has nowhere to go, whichever door it came through."""
        row = self.client.post(
            f"/api/tables/{self.table['id']}/rows/", {"data": {"narx": 1000, "soni": 2}}, format="json"
        ).data

        self.client.patch(
            f"/api/tables/{self.table['id']}/rows/{row['id']}/",
            {"data": {"narx": 1000, "soni": 2, "hisob": 999}},
            format="json",
        )

        self.assertNotIn("hisob", TableRow.objects.get(pk=row["id"]).data)


class SpreadsheetTransferTests(TestCase):
    """Excel in and Excel out — and the round trip between them.

    The round trip is the test worth having. Export and import are two halves
    of one promise, and the way that promise breaks is not a crash: it is a
    file that opens perfectly and comes back with the reference column emptied
    or the prices turned into text.
    """

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("x@b.uz", "wsx")
        self.table = Table.objects.create(
            workspace=self.workspace, name="Xizmatlar narxlari", handle="narxlar", columns=COLUMNS
        )
        TableRow.objects.create(table=self.table, data={"xizmat": "MRT", "narx": 240000})
        TableRow.objects.create(table=self.table, data={"xizmat": "UZI", "narx": 150000})
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def upload(self, content: bytes, name: str = "narxlar.xlsx"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return self.client.post(
            f"/api/tables/{self.table.id}/import/",
            {"file": SimpleUploadedFile(name, content)},
            format="multipart",
        )

    def test_export_carries_the_labels_and_the_values(self):
        from apps.tables.xlsx import read_xlsx

        response = self.client.get(f"/api/tables/{self.table.id}/export/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheetml", response["Content-Type"])
        self.assertIn("attachment;", response["Content-Disposition"])
        grid = read_xlsx(response.content)
        self.assertEqual(grid[0], ["Xizmat", "Narx"], "the header a person reads, not the keys")
        self.assertEqual({row[0] for row in grid[1:]}, {"MRT", "UZI"})
        self.assertEqual({row[1] for row in grid[1:]}, {"240000", "150000"})

    def test_a_file_this_wrote_can_be_read_straight_back(self):
        exported = self.client.get(f"/api/tables/{self.table.id}/export/").content

        response = self.upload(exported)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["added"], 2)
        self.assertEqual(self.table.rows.count(), 4, "appended, not replaced")
        prices = sorted(row.data["narx"] for row in self.table.rows.all())
        self.assertEqual(prices, [150000, 150000, 240000, 240000], "still numbers, not text")

    def test_column_keys_are_accepted_as_headings_too(self):
        from apps.tables.xlsx import write_xlsx

        response = self.upload(write_xlsx(["xizmat", "narx"], [["EKG", 90000]]))

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.table.rows.filter(data__xizmat="EKG").count(), 1)

    def test_a_heading_nothing_matches_is_ignored_rather_than_refused(self):
        from apps.tables.xlsx import write_xlsx

        response = self.upload(write_xlsx(["Xizmat", "Narx", "Izoh"], [["EKG", 90000, "shoshilinch"]]))

        self.assertEqual(response.status_code, 201, response.data)
        row = self.table.rows.get(data__xizmat="EKG")
        self.assertNotIn("izoh", row.data, "the column this table does not have is dropped")

    def test_nothing_is_written_when_one_row_is_wrong(self):
        from apps.tables.xlsx import write_xlsx

        response = self.upload(write_xlsx(["Xizmat", "Narx"], [["EKG", 90000], ["KT", "bepul"]]))

        self.assertEqual(response.status_code, 400)
        message = response.data["error"]["message"]
        self.assertIn("3-qator", message, "the line as Excel numbers it")
        self.assertIn("«Narx»", message, "the heading the reader can see, not the key underneath it")
        self.assertNotIn("«narx»", message)
        self.assertEqual(self.table.rows.count(), 2, "the valid row above the bad one is not filed either")

    def test_a_file_whose_headings_match_nothing_says_what_was_expected(self):
        from apps.tables.xlsx import write_xlsx

        response = self.upload(write_xlsx(["Ism", "Telefon"], [["Aziza", "901"]]))

        self.assertEqual(response.status_code, 400)
        self.assertIn("Xizmat", response.data["error"]["message"])
        self.assertEqual(self.table.rows.count(), 2)

    def test_csv_is_accepted_because_that_is_what_excel_saves(self):
        response = self.upload("Xizmat,Narx\nEKG,90000\n".encode("utf-8-sig"), name="narxlar.csv")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.table.rows.get(data__xizmat="EKG").data["narx"], 90000)

    def test_blank_lines_at_the_end_are_not_rows(self):
        response = self.upload(b"Xizmat,Narx\nEKG,90000\n,\n,\n", name="narxlar.csv")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["added"], 1)

    def test_something_that_is_not_a_spreadsheet_is_refused_readably(self):
        response = self.upload(b"PK\x03\x04 not really a zip", name="narxlar.xlsx")

        self.assertEqual(response.status_code, 400)
        self.assertIn(".xlsx", response.data["error"]["message"])

    def test_another_workspace_can_neither_read_nor_write_this_table(self):
        stranger, _ = a_workspace("z@b.uz", "wsz")
        other = APIClient()
        other.force_authenticate(stranger)

        self.assertEqual(other.get(f"/api/tables/{self.table.id}/export/").status_code, 404)
        self.assertEqual(self.table.rows.count(), 2)


class SpreadsheetDateTests(TestCase):
    """Excel stores a date as a number and says so only in the cell's style.

    Without the style pass, "12-mart" arrives as 46093 and lands in the table
    as a number nobody typed — the one silent failure in this whole path.
    """

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("d@b.uz", "wsd")
        self.table = Table.objects.create(
            workspace=self.workspace,
            name="Uchrashuvlar",
            handle="uchrashuvlar",
            columns=[
                {"key": "kim", "label": "Kim", "type": "text"},
                {"key": "qachon", "label": "Qachon", "type": "date"},
            ],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_a_dated_cell_comes_back_as_an_iso_string(self):
        from apps.tables.xlsx import read_xlsx

        response = self.client.post(
            f"/api/tables/{self.table.id}/import/",
            {"file": self._excel_with_a_real_date()},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.table.rows.get().data["qachon"], "2026-03-12")
        # And the same value survives being written back out.
        grid = read_xlsx(self.client.get(f"/api/tables/{self.table.id}/export/").content)
        self.assertEqual(grid[1][1], "2026-03-12")

    def _excel_with_a_real_date(self):
        """A workbook Excel itself would produce: a serial plus a date style.

        Hand-built rather than exported by `write_xlsx`, because that writer
        has no styles at all — the point of the test is the file this product
        *receives*, not the one it sends.
        """
        import io
        import zipfile

        from django.core.files.uploadedfile import SimpleUploadedFile

        from apps.tables.xlsx import MAIN, PKG_REL, REL

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "[Content_Types].xml",
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                "</Types>",
            )
            archive.writestr(
                "_rels/.rels",
                f'<Relationships xmlns="{PKG_REL}">'
                f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            )
            archive.writestr(
                "xl/workbook.xml",
                f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>'
                '<sheet name="List" sheetId="1" r:id="rId1"/></sheets></workbook>',
            )
            archive.writestr(
                "xl/_rels/workbook.xml.rels",
                f'<Relationships xmlns="{PKG_REL}">'
                f'<Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
            )
            # numFmtId 14 is the built-in short date; cellXfs index 1 uses it.
            archive.writestr(
                "xl/styles.xml",
                f'<styleSheet xmlns="{MAIN}"><cellXfs count="2">'
                '<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>',
            )
            archive.writestr(
                "xl/sharedStrings.xml",
                f'<sst xmlns="{MAIN}" count="3" uniqueCount="3">'
                "<si><t>Kim</t></si><si><t>Qachon</t></si><si><t>Aziza</t></si></sst>",
            )
            archive.writestr(
                "xl/worksheets/sheet1.xml",
                f'<worksheet xmlns="{MAIN}"><sheetData>'
                '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
                '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46093</v></c></row>'
                "</sheetData></worksheet>",
            )
        return SimpleUploadedFile("uchrashuvlar.xlsx", buffer.getvalue())


class KeyValueStoreTests(TestCase):
    """A `kv` store is a two-column table with one rule, and the rule is the point.

    The columns being fixed is cosmetic — a reader could have typed those two
    themselves. What makes it a *store* is that a key cannot repeat, and the
    tests worth having are the four doors a row can arrive through: the panel,
    a correction, the open webhook and a spreadsheet.
    """

    def setUp(self) -> None:
        cache.clear()
        self.user, self.workspace = a_workspace("kv@b.uz", "wskv")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.table = self.create_kv()

    def create_kv(self, **payload):
        body = {"name": "Sozlamalar", "kind": "kv", "columns": [], **payload}
        response = self.client.post("/api/tables/", body)
        self.assertEqual(response.status_code, 201, response.data)
        return Table.objects.get(pk=response.data["id"])

    def add(self, key, value, table=None):
        return self.client.post(
            f"/api/tables/{(table or self.table).id}/rows/",
            {"data": {"kalit": key, "qiymat": value}},
            format="json",
        )

    def test_the_pair_is_the_shape_whatever_columns_were_asked_for(self):
        table = self.create_kv(
            name="Boshqa", columns=[{"key": "narx", "label": "Narx", "type": "number"}]
        )

        self.assertEqual([c["key"] for c in table.columns], ["kalit", "qiymat"])
        self.assertTrue(table.is_kv)

    def test_a_key_cannot_be_used_twice(self):
        self.assertEqual(self.add("ish_vaqti", "09:00-18:00").status_code, 201)

        response = self.add("ish_vaqti", "10:00-19:00")

        self.assertEqual(response.status_code, 400)
        self.assertIn("ish_vaqti", response.data["error"]["message"])
        self.assertEqual(self.table.rows.count(), 1, "the second one is refused, not appended")

    def test_a_row_does_not_collide_with_itself_when_corrected(self):
        row_id = self.add("ish_vaqti", "09:00-18:00").data["id"]

        response = self.client.patch(
            f"/api/tables/{self.table.id}/rows/{row_id}/",
            {"data": {"kalit": "ish_vaqti", "qiymat": "10:00-19:00"}},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.table.rows.get().data["qiymat"], "10:00-19:00")

    def test_a_blank_key_is_refused(self):
        response = self.add("   ", "nimadir")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.table.rows.count(), 0)

    def test_the_open_webhook_obeys_the_same_rule(self):
        self.add("ish_vaqti", "09:00-18:00")

        response = self.client.post(
            f"/api/tables/hook/{self.table.webhook_secret}/",
            {"data": {"kalit": "ish_vaqti", "qiymat": "boshqa"}},
            format="json",
        )

        self.assertEqual(response.status_code, 400, "the door nobody here controls is not the exception")
        self.assertEqual(self.table.rows.count(), 1)

    def test_a_spreadsheet_repeating_a_key_inside_itself_is_refused(self):
        from apps.tables.xlsx import write_xlsx
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            f"/api/tables/{self.table.id}/import/",
            {
                "file": SimpleUploadedFile(
                    "s.xlsx",
                    write_xlsx(["Kalit", "Qiymat"], [["a", "1"], ["b", "2"], ["a", "3"]]),
                )
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("ikki marta", response.data["error"]["message"])
        self.assertEqual(self.table.rows.count(), 0, "nothing filed — not even the two good ones")

    def test_the_kind_cannot_be_changed_afterwards(self):
        response = self.client.patch(f"/api/tables/{self.table.id}/", {"kind": "table"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.table.refresh_from_db()
        self.assertEqual(self.table.kind, "kv", "a price list and a dictionary are not convertible")

    def test_columns_cannot_be_edited_away_from_the_pair(self):
        response = self.client.patch(
            f"/api/tables/{self.table.id}/",
            {"columns": [{"key": "boshqa", "label": "Boshqa", "type": "text"}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.table.refresh_from_db()
        self.assertEqual([c["key"] for c in self.table.columns], ["kalit", "qiymat"])

    def test_an_ordinary_table_is_unaffected_by_any_of_this(self):
        table = Table.objects.create(
            workspace=self.workspace, name="Narxlar", handle="narxlar2", columns=COLUMNS
        )

        self.assertEqual(self.add("x", "1", table=table).status_code, 201)
        self.assertEqual(self.add("x", "2", table=table).status_code, 201, "repeats are fine here")

    def test_an_unknown_kind_is_refused(self):
        response = self.client.post(
            "/api/tables/", {"name": "X", "kind": "graph", "columns": COLUMNS}
        )

        self.assertEqual(response.status_code, 400)
