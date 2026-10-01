"use client";

import { useLinkStatus } from "next/link";

/**
 * Acknowledges a click on a nav link that hasn't landed yet.
 *
 * A route the router has already prefetched commits immediately and this never
 * shows. It earns its place on the ones that don't: a cold route makes the
 * sidebar sit there looking untouched while the destination is fetched, and a
 * click with no answer reads as a broken button rather than a slow one.
 *
 * Must be rendered inside the <Link> it reports on — that is how the hook finds
 * which navigation to watch.
 */
export function NavPendingDot() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`nav-pending-dot${pending ? " is-pending" : ""}`} />;
}
