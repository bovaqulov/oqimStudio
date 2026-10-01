/** One line off the workspace socket. */
export interface RealtimeEvent {
  /** `message.new`, `notification.created`, `bot.activity` … */
  event: string;
  payload: Record<string, unknown>;
}

/** What the server hands back in exchange for an authenticated request. */
export interface SocketPass {
  /** Signed, good for `expiresIn` seconds, and only for `group`. */
  ticket: string;
  expiresIn: number;
  group: string;
  /** Where to connect — the *public* address, which only the backend knows. */
  url: string;
}

/**
 * Why no pass was issued, and whether asking again could ever change that.
 *
 * `final` is the whole point of this type. A socket that reconnects forever is
 * right for a server that is down and wrong for a caller the server will keep
 * refusing — an account that has not confirmed its address, or one that is not
 * a member here. Without it those two look identical to the store, and it
 * treats both as the first: a background poll every thirty seconds, for as
 * long as the tab is open, that cannot succeed.
 */
export interface SocketPassFailure {
  error: string;
  final: boolean;
}
