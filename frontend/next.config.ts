import type { NextConfig } from "next";

/**
 * The origins this app is reachable at, as written down by a person.
 *
 * Next compares the request's `Origin` against `Host`/`X-Forwarded-Host` and
 * aborts when they disagree — which is exactly what happens behind a reverse
 * proxy or a tunnel. Listing the proxy here is the supported way to say "this
 * one is us"; it is read from the environment so a temporary tunnel name is
 * never committed. Wildcards are allowed: `*.trycloudflare.com`.
 *
 * Full origins here, hosts below — `restore.sh` writes this list and a person
 * reads it, and `http://127.0.0.1:3000` is what either of them would write.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * One entry, as Next wants to read it: a bare host, no scheme and no port.
 *
 * Both docs spell it that way — `allowedDevOrigins: ['local-origin.dev']` and
 * `serverActions: { allowedOrigins: ['my-proxy.com'] }` — and the port is the
 * half that was missed. `ALLOWED_ORIGINS` holds full origins because that is
 * what a person writes down, so `http://127.0.0.1:3000` reached the dev-origin
 * list as `127.0.0.1:3000`, matched nothing, and the dev server answered 403
 * to its own `/_next/static/chunks/*`.
 *
 * What that looks like is the reason it survived: the page renders. The HTML is
 * complete and correct, the bundle never arrives, and hydration never happens —
 * so every button, sheet and toggle is dead while the screenshot looks right.
 * Server Actions fail the same way from the same cause, as
 * "An unexpected response was received from the server".
 *
 * `localhost` is on Next's default list and `127.0.0.1` is not, which is what
 * made this look like it worked.
 */
const bareHost = (origin: string) => origin.replace(/^[a-z]+:\/\//, "").replace(/:\d+$/, "");

/**
 * Origins allowed to request dev assets, and to invoke Server Actions.
 *
 * The same list feeds both because they are the same question — "is this
 * request coming from us" — asked by two guards, and a host trusted for one
 * and not the other is the shape of a bug nobody can see.
 */
const allowedHosts = [...new Set(allowedOrigins.map(bareHost))].filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /*
   * The dev overlay, off.
   *
   * It is Next's own indicator and not this product's markup — it exists only
   * under `next dev` and no production build has ever drawn it — but it is
   * pinned to a corner of the viewport, and every corner here is occupied:
   * `bottom-left` (its default) sits over the workspace name in the sidebar
   * and over the mobile tab bar, and the other three are the theme toggle, the
   * sidebar header and the page header's actions. There is no free corner to
   * move it to, so the only configuration that stops it covering the product
   * is not drawing it. Compile and runtime errors are still surfaced —
   * `devIndicators: false` turns off the badge, not the error overlay.
   */
  devIndicators: false,
  // Lets a second instance build into its own folder, so a debug `next dev`
  // can run beside a `next start` serving the same checkout.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  ...(allowedHosts.length ? { experimental: { serverActions: { allowedOrigins: allowedHosts } } } : {}),
  ...(allowedHosts.length ? { allowedDevOrigins: allowedHosts } : {}),
};

export default nextConfig;
