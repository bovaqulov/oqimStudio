/**
 * How this app's cookies have to be written to survive inside Telegram.
 *
 * A Mini App opened from Telegram Web runs in an `<iframe>` on
 * `web.telegram.org`. Our own cookies are first-party to our domain but the
 * *context* is cross-site, and a `SameSite=Lax` cookie is simply not attached
 * to requests made from there. That produced a sign-in loop with no error
 * anywhere: the gate posted `initData`, the server answered 200 and set the
 * session, the client navigated to `/dashboard`, the browser sent no cookie,
 * the route guard saw a signed-out visitor and bounced back to `/login` — where
 * the gate signed in again. The backend log showed five successful logins in a
 * row and the reader saw a spinner.
 *
 * `SameSite=None` is what makes the cookie travel in that context, `Secure` is
 * mandatory alongside it, and `Partitioned` (CHIPS) is what keeps it working as
 * browsers finish removing unpartitioned third-party cookies — it gives the
 * cookie its own jar keyed to the embedding site, which is exactly the scope a
 * Mini App session should have anyway.
 *
 * Over plain HTTP none of that is possible: a `Secure` cookie is discarded, so
 * a developer on `http://localhost:3000` would be unable to sign in at all.
 * There, and only there, it stays `Lax` — which is correct, because a page on
 * localhost is not embedded in anything.
 */
export interface CookieScope {
  sameSite: "lax" | "none";
  secure: boolean;
  partitioned: boolean;
}

const EMBEDDABLE: CookieScope = { sameSite: "none", secure: true, partitioned: true };
const FIRST_PARTY: CookieScope = { sameSite: "lax", secure: false, partitioned: false };

/**
 * The scope for a given host.
 *
 * The question is really "can this cookie carry `Secure`", and the honest way
 * to answer it on the server is the host — not `x-forwarded-proto`, which is
 * whatever the proxy in front of us chose to send and is absent often enough
 * that trusting it would silently reinstate the sign-in loop. Everything that
 * is not loopback is served over HTTPS in this product: the tunnel terminates
 * TLS, and so does any real deployment. Loopback is the one place a `Secure`
 * cookie would be dropped, and it is also the one place nothing is embedded in
 * an iframe, so `Lax` is both necessary and correct there.
 */
export function cookieScopeFor(host: string | null | undefined): CookieScope {
  const name = (host ?? "").split(":")[0]!.toLowerCase();
  const loopback = name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1";
  return loopback ? FIRST_PARTY : EMBEDDABLE;
}

/** `document.cookie` attributes for the same decision, made in the browser. */
export function cookieAttributes(): string {
  // The browser knows for certain, so it asks the only question that matters.
  const scope =
    typeof location !== "undefined" && location.protocol === "https:" ? EMBEDDABLE : FIRST_PARTY;
  return [
    `samesite=${scope.sameSite}`,
    scope.secure ? "secure" : "",
    scope.partitioned ? "partitioned" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
