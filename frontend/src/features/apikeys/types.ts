/**
 * Scopes a key may hold — exactly the four the backend accepts.
 *
 * The strings are the contract, not a label: they are what a caller writes in
 * their own configuration and what the backend matches on. Nothing in the
 * interface translates or abbreviates them away, it only ever adds a sentence
 * beside them.
 */
export type ApiKeyScope = "flows:read" | "flows:write" | "bots:read" | "contacts:read";

/**
 * A key as the list knows it — which is everything except the key.
 *
 * The backend keeps a hash and nothing else, so no read can ever return the
 * credential again. `prefix` is the visible head of it ("oq_live_a3f9"), and it
 * is the only thing that ties a row on this screen to a token in somebody's
 * configuration file.
 */
export interface ApiKey {
  id: string;
  name: string;
  /** The visible head of the credential. Enough to recognise, useless to use. */
  prefix: string;
  /**
   * Plain strings rather than `ApiKeyScope[]`: a key minted before a scope was
   * renamed still carries the old name, and a screen that filtered out what it
   * did not recognise would understate what that key can still reach.
   * `describeScope` prints whatever arrives.
   */
  scopes: string[];
  createdBy: string;
  /** "12 mart 2026". */
  createdAt: string;
  /** "3 kun oldin", or `null` when nothing has ever authenticated with it. */
  lastUsedAt: string | null;
  /** "12 mart 2026" once revoked; `null` while the key still opens the door. */
  revokedAt: string | null;
}

/**
 * The one moment the credential exists outside the caller's own configuration.
 *
 * Returned by the create action and held in client state for as long as the
 * sheet showing it is open. It is never written to a repository, never part of
 * a list read, and never re-fetched — there is nowhere to re-fetch it from.
 */
export interface CreatedApiKey {
  /**
   * The full credential. Named `secret` and not `key` so that no call site can
   * write `key.key` and leave the next reader guessing which of the two is the
   * one that must not be logged.
   */
  secret: string;
  name: string;
  prefix: string;
  scopes: string[];
}
