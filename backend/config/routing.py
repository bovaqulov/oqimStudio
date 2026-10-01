"""WebSocket URLs, kept next to the HTTP ones rather than inside an app.

Every consumer lives in `apps.realtime`; the paths are here so `config/asgi.py`
has one import and the app does not have to know how it is mounted.
"""

from __future__ import annotations

from django.urls import path

from apps.realtime import consumers

websocket_urlpatterns = [
    # Everything happening in the workspace: notifications, bot status, the
    # dashboard's live counters.
    path("ws/workspace/<str:workspace_id>/", consumers.WorkspaceConsumer.as_asgi()),
    # One flow's runs, step by step — what the editor's test chat listens to.
    path("ws/flows/<str:flow_id>/", consumers.FlowConsumer.as_asgi()),
    # One bot's incoming updates and outgoing sends: the live inbox.
    path("ws/bots/<str:bot_id>/", consumers.BotConsumer.as_asgi()),
]
