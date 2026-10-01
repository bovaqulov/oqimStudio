"use client";

import { socketPassAction } from "./actions";
import type { RealtimeEvent } from "./types";

/**
 * One socket for the whole page, however many things are listening.
 *
 * The alternative — a hook that opens its own connection — costs a socket per
 * component, and this app would open three on the chats screen alone: the
 * list, the thread and the notification bell. Each would carry its own
 * handshake, its own pass and its own reconnect timer, and a flaky network
 * would produce three independent recoveries where one is wanted.
 *
 * So the connection lives here, module-scope, and is reference-counted: it
 * opens when the first listener arrives and closes when the last one leaves.
 * Nothing outside this file touches the `WebSocket`.
 */

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
/** Consecutive failures, for the backoff. Reset by a socket that opens. */
let attempts = 0;
/** Set while a connect is in flight, so two listeners do not race one open. */
let connecting = false;
/**
 * Set when the server refused the pass in a way retrying cannot change.
 *
 * Reset by `disconnect`, which runs when the last listener leaves — so the
 * next screen that subscribes asks again. That is the boundary on purpose: an
 * account that confirms its address in another tab gets its socket back the
 * next time something mounts, without the store having to poll for the news.
 */
let refused = false;

/** Keeps an idle socket from being closed by something in the middle. */
const PING_MS = 30_000;
/** Backoff: a quick first retry, then doubling, capped where it stops mattering. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

function delay(): number {
  const step = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
  // Jitter, because every open tab reconnects at the same instant otherwise —
  // a server coming back up gets the whole workspace at once without it.
  return step / 2 + Math.random() * (step / 2);
}

function clearTimers(): void {
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  reconnectTimer = undefined;
  pingTimer = undefined;
}

function scheduleReconnect(): void {
  if (!listeners.size || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connect();
  }, delay());
  attempts += 1;
}

async function connect(): Promise<void> {
  if (connecting || socket || !listeners.size) return;
  connecting = true;
  try {
    const pass = await socketPassAction();
    // Still wanted? A page can navigate away inside the round trip.
    if (!listeners.size) {
      connecting = false;
      return;
    }
    if ("error" in pass) {
      connecting = false;
      // A refusal is not an outage. Reconnecting past one is a request that
      // will be refused identically every thirty seconds until the tab is
      // closed, and nothing about it can succeed — so this stops instead, and
      // `isConnected` goes on reporting false, which is what the status dot
      // already reads.
      if (pass.final) {
        refused = true;
        clearTimers();
        return;
      }
      scheduleReconnect();
      return;
    }

    const opened = new WebSocket(`${pass.url}?ticket=${encodeURIComponent(pass.ticket)}`);
    socket = opened;

    opened.onopen = () => {
      attempts = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (opened.readyState === WebSocket.OPEN) opened.send(JSON.stringify({ type: "ping" }));
      }, PING_MS);
    };

    opened.onmessage = (message) => {
      let parsed: RealtimeEvent;
      try {
        parsed = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!parsed?.event) return;
      // A copy, because a listener may unsubscribe itself while being called.
      for (const listener of [...listeners]) listener(parsed);
    };

    opened.onclose = () => {
      if (socket === opened) socket = null;
      clearInterval(pingTimer);
      pingTimer = undefined;
      scheduleReconnect();
    };

    // `onerror` is followed by `onclose` in every browser, so the reconnect is
    // scheduled once, there. Handling both would double the backoff step.
    opened.onerror = () => {};
  } finally {
    connecting = false;
  }
}

function disconnect(): void {
  clearTimers();
  attempts = 0;
  refused = false;
  const open = socket;
  socket = null;
  if (open) {
    // Silenced first: the handler would otherwise schedule a reconnect for a
    // socket nobody is listening to any more.
    open.onclose = null;
    open.close();
  }
}

/**
 * Starts listening, and keeps the connection alive while anybody is.
 *
 * Returns the unsubscribe, which is what a React effect hands back — so the
 * socket's lifetime follows the mounted components exactly.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!socket && !connecting && !refused) void connect();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) disconnect();
  };
}

/** Whether a socket is currently open — for a status dot, and for tests. */
export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}
