/*
 * The feature's public surface, for the server side.
 *
 * It re-exports the repository, which imports `server-only` — so a client
 * component must never reach for this barrel. Those import `./types`,
 * `./handle`, `./values` and `./actions` directly, which is the rule every
 * other feature here follows and the reason the build does not break.
 */
export * from "./types";
export * from "./handle";
export * from "./values";
export * from "./data/tables-repository";
