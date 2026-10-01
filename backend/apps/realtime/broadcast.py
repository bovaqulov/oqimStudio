"""Pushing events to whoever is watching.

One function, called from ordinary synchronous code (views, Celery tasks, the
flow runtime). Everything that needs to reach a browser goes through here, so
group naming lives in one place and a caller never touches the channel layer
directly.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
from contextlib import contextmanager
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

#: While a buffer is active on this task, `publish` appends instead of sending.
#:
#: One update walks several blocks, and each block publishes twice — a Redis
#: round-trip apiece, each spinning up its own event loop through
#: `async_to_sync`. That work sat *between* the messages the customer was being
#: sent, so a three-message flow paid six round-trips of delay it did not need
#: to. Buffered, the whole update's events go out in one `gather` after the
#: walk, off the path between one send and the next. Realtime is best-effort
#: (see `publish`), so a dashboard seeing the trace arrive in one burst a few
#: milliseconds later, or not at all, was always the deal.
_buffer: contextvars.ContextVar[list[tuple[str, dict]] | None] = contextvars.ContextVar(
    "realtime_buffer", default=None
)


def workspace_group(workspace_id: str) -> str:
    return f"ws.workspace.{workspace_id}"


def flow_group(flow_id: str) -> str:
    return f"ws.flow.{flow_id}"


def bot_group(bot_id: str) -> str:
    return f"ws.bot.{bot_id}"


def publish(group: str, event: str, payload: dict[str, Any] | None = None) -> None:
    """Sends one event to a group.

    Never raises: a browser that is not listening, or a Redis that is briefly
    away, must not fail the message the customer was actually sent. The event
    is a courtesy on top of state that is already in the database.
    """
    message = {"type": "broadcast", "event": event, "payload": payload or {}}

    # Inside a walk: hold it, so it does not sit between two customer sends.
    buffer = _buffer.get()
    if buffer is not None:
        buffer.append((group, message))
        return

    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group, message)
    except Exception as exc:  # noqa: BLE001 - realtime is best-effort by design
        # One line, not a traceback: with Redis down this fires on every step of
        # every run, and a wall of stack traces would bury the messages that
        # actually did get delivered. The detail is there at DEBUG.
        logger.warning("realtime publish failed for %s/%s: %s", group, event, exc)
        logger.debug("realtime publish traceback", exc_info=True)


@contextmanager
def buffered_publishing():
    """Holds every `publish` inside it and sends them together on exit.

    Wrap the handling of one update in this: the events still go out, in order,
    but as a single batch after the run has finished sending — not interleaved
    with the sends themselves.
    """
    token = _buffer.set([])
    try:
        yield
    finally:
        items = _buffer.get() or []
        _buffer.reset(token)
        _flush(items)


def _flush(items: list[tuple[str, dict]]) -> None:
    if not items:
        return
    layer = get_channel_layer()
    if layer is None:
        return

    async def _send_all() -> None:
        # Concurrently, and swallowing per-event failures: one browser that has
        # gone away must not take the rest of the batch with it.
        await asyncio.gather(*(layer.group_send(group, message) for group, message in items), return_exceptions=True)

    try:
        async_to_sync(_send_all)()
    except Exception as exc:  # noqa: BLE001 - realtime is best-effort by design
        logger.warning("realtime flush failed (%s events): %s", len(items), exc)
        logger.debug("realtime flush traceback", exc_info=True)
