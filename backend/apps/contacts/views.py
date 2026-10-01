"""Contact endpoints — read, tag, set variables, export.

This is where a bot's work becomes visible. Everything a flow collected lives
on the contact: the answers, the tags, when they last wrote. A clinic's front
desk reads this list, so it also has to leave the app — hence the CSV.

Contacts are never created here: they arrive by writing to the bot, and a row
this API invented would be a person Telegram has never heard of.
"""

from __future__ import annotations

import csv
from datetime import datetime, time

from django.db.models import OuterRef, Q, Subquery
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.exceptions import ApiError
from apps.common.i18n import LANGUAGE_LABELS
from apps.common.tenancy import IsWorkspaceMember, WorkspaceScopedMixin
from apps.flows.models import FlowRun

from .models import Contact, ContactTag
from .serializers import ContactHistorySerializer, ContactSerializer

#: Columns of the export, in the order a front desk reads them.
EXPORT_COLUMNS = ["Ism", "Telefon", "Username", "Bot", "Til", "Kelgan oqim", "Oxirgi faollik", "Holat", "Teglar"]

#: How many variable columns a caller may add to the table or the export. A
#: reader who wants more than this wants the CSV of everything, not a table.
MAX_VARIABLE_COLUMNS = 8

#: How many rows the column picker looks through for variable names. Names are
#: read out of the contacts themselves — there is no table of them, because a
#: variable is whatever a flow author called it — so the scan is bounded.
VARIABLE_SCAN_LIMIT = 500


def _parse_day(value: str | None, end_of_day: bool = False) -> datetime | None:
    """`YYYY-MM-DD` from a filter bar, as an instant."""
    if not value:
        return None
    try:
        day = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
    moment = datetime.combine(day, time.max if end_of_day else time.min)
    return timezone.make_aware(moment) if timezone.is_naive(moment) else moment


def _cell(value) -> str:
    """A stored answer as one CSV cell. Anything a block wrote is fair game —
    a checklist writes a list, an HTTP block writes an object."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value)
    return str(value)


def _variable_columns(params) -> list[str]:
    """The variable names the reader added as columns, from `?columns=a,b`."""
    raw = params.get("columns") or ""
    names = [name.strip() for name in raw.split(",") if name.strip()]
    # De-duplicated in place: the URL is hand-editable and a repeated column
    # would print the same value twice.
    return list(dict.fromkeys(names))[:MAX_VARIABLE_COLUMNS]


class ContactViewSet(WorkspaceScopedMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ContactSerializer
    permission_classes = [IsWorkspaceMember]
    queryset = Contact.objects.select_related("bot").prefetch_related("tags").all()

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        # Which flow first reached this person — the one thing about a contact
        # that lives in another table and that everybody asks about first.
        first_run = FlowRun.objects.filter(contact=OuterRef("pk")).order_by("started_at")
        queryset = queryset.annotate(
            source_flow_name=Subquery(first_run.values("flow__name")[:1]),
            source_flow_id=Subquery(first_run.values("flow_id")[:1]),
        )

        # A project is a business, and a workspace can hold two of them. Without
        # this the clinic's patients and the school's students were one list —
        # which is a privacy problem before it is a usability one.
        if params.get("projectId"):
            queryset = queryset.filter(bot__project_id=params["projectId"])
        if params.get("botId"):
            queryset = queryset.filter(bot_id=params["botId"])
        if params.get("flowId"):
            queryset = queryset.filter(runs__flow_id=params["flowId"])
        if params.get("tag"):
            queryset = queryset.filter(tags__name=params["tag"])
        if params.get("status") == "blocked":
            queryset = queryset.filter(is_blocked=True)
        elif params.get("status") == "active":
            queryset = queryset.filter(is_blocked=False)

        since = _parse_day(params.get("from"))
        until = _parse_day(params.get("to"), end_of_day=True)
        if since:
            queryset = queryset.filter(last_seen_at__gte=since)
        if until:
            queryset = queryset.filter(last_seen_at__lte=until)

        search = (params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(username__icontains=search)
                | Q(phone__icontains=search)
            )
        return queryset.distinct()

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Every conversation this person has had with the bot, oldest first.

        The whole trace, not a summary: what the bot asked, what they answered
        and where it stopped is what somebody picking the conversation up needs.
        """
        contact = self.get_object()
        runs = (
            FlowRun.objects.filter(contact=contact)
            .select_related("flow")
            .prefetch_related("steps")
            .order_by("started_at")
        )
        return Response(ContactHistorySerializer(runs, many=True).data)

    @action(detail=False, methods=["get"], url_path="variable-keys")
    def variable_keys(self, request):
        """Every variable name the flows have written, for the column picker.

        Read out of the rows rather than from a table of names: a variable is
        whatever the author of a "Teg / o'zgaruvchi" block called it, so a list
        kept beside them would be one more thing that can go stale. The same
        filters apply as to the list, so the picker offers the names that
        actually appear in what the reader is looking at.
        """
        names: set[str] = set()
        for variables in self.get_queryset().values_list("variables", flat=True)[:VARIABLE_SCAN_LIMIT]:
            names.update(key for key in (variables or {}) if isinstance(key, str))
        return Response(sorted(names))

    @action(detail=True, methods=["post"])
    def tags(self, request, pk=None):
        """Adds or removes one tag by hand — the same tags a "Teg" block writes."""
        contact = self.get_object()
        name = (request.data.get("name") or "").strip()
        if not name:
            raise ApiError("tag_required", "Teg nomini kiriting", field="name")

        if request.data.get("remove"):
            ContactTag.objects.filter(contact=contact, name=name).delete()
        else:
            ContactTag.objects.get_or_create(contact=contact, name=name)
        return Response(ContactSerializer(contact).data)

    @action(detail=True, methods=["post"])
    def variables(self, request, pk=None):
        contact = self.get_object()
        updates = request.data.get("variables") or {}
        if not isinstance(updates, dict):
            raise ApiError("invalid_variables", "O'zgaruvchilar obyekt bo'lishi kerak", field="variables")
        contact.variables.update(updates)
        contact.save(update_fields=["variables"])
        return Response(ContactSerializer(contact).data)

    @action(detail=False, methods=["get"])
    def export(self, request):
        """The filtered list as CSV, with whatever columns the table is showing.

        UTF-8 with a BOM on purpose: without it Excel opens Uzbek names as
        mojibake, and a list nobody can read is not an export.
        """
        rows = self.get_queryset()[:5000]
        columns = _variable_columns(request.query_params)
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        stamp = timezone.now().strftime("%Y-%m-%d")
        response["Content-Disposition"] = f'attachment; filename="kontaktlar-{stamp}.csv"'
        response.write("﻿")

        writer = csv.writer(response)
        writer.writerow(EXPORT_COLUMNS + columns)
        for contact in rows:
            writer.writerow(
                [
                    contact.display_name,
                    contact.phone or contact.variables.get("mijoz_telefoni", ""),
                    f"@{contact.username}" if contact.username else "",
                    contact.bot.handle,
                    LANGUAGE_LABELS.get(contact.language, contact.language),
                    getattr(contact, "source_flow_name", "") or "",
                    timezone.localtime(contact.last_seen_at).strftime("%Y-%m-%d %H:%M"),
                    "Bloklangan" if contact.is_blocked else "Faol",
                    ", ".join(contact.tag_names()),
                ]
                + [_cell(contact.variables.get(name)) for name in columns]
            )
        return response
