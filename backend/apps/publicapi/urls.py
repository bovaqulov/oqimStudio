"""Routes for `/api/v1/`.

Written out by hand rather than through a router, and that is the point of the
whole app: a router publishes whatever a viewset happens to have on it, so an
`@action` added to an internal viewset next month would appear on the public
API without anybody deciding it should. Every line below is a promise somebody
made on purpose, and there is no mechanism here that can make one by accident.
"""

from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    # The credential describing itself. No scope, because the key that cannot
    # read anything is the one whose holder needs to know why.
    path("me/", views.KeyIdentityView.as_view(), name="v1-me"),
    path("flows/", views.FlowListView.as_view(), name="v1-flow-list"),
    # Before `<str:flow_id>/`, or "import" would be read as a flow id and the
    # POST would 404 on a flow nobody has.
    path("flows/import/", views.FlowImportView.as_view(), name="v1-flow-import"),
    path("flows/<str:pk>/", views.FlowDetailView.as_view(), name="v1-flow-detail"),
    path("flows/<str:flow_id>/graph/", views.FlowGraphView.as_view(), name="v1-flow-graph"),
    path("bots/", views.BotListView.as_view(), name="v1-bot-list"),
    path("contacts/", views.ContactListView.as_view(), name="v1-contact-list"),
]
