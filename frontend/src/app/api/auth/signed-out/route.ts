import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/features/auth/session-cookie";
import { TOKEN_COOKIE, WORKSPACE_COOKIE } from "@/lib/api/server";

/**
 * Where a credential the backend no longer honours goes to die.
 *
 * A server component cannot delete a cookie — only a route handler or an
 * action can — so a page that discovers its token is dead can do nothing but
 * redirect to the login screen, which the route guard then bounces straight
 * back inside on the strength of the same stale cookie. That is a redirect
 * loop, and it is what a reader sees after the database behind their session
 * is replaced.
 *
 * This route is the one place that can end it: clear all three cookies, then
 * hand the reader to the login form with nothing left to bounce on. It sits
 * under `/api`, which the guard does not run on.
 */
export function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") || "auth";
  const next = request.nextUrl.searchParams.get("next");

  const params = new URLSearchParams({ reason });
  // Only same-site paths: an open redirect is one `?next=https://…` away.
  if (next && next.startsWith("/") && !next.startsWith("//")) params.set("next", next);

  // A *relative* Location, deliberately. Behind a tunnel or a load balancer
  // this server's own origin is `localhost:3000`, and an absolute redirect
  // built from it would send the reader to their own machine.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: `/login?${params}` },
  });
  // `oqim_uid` is written by the browser next to the session cookie; a
  // leftover copy of it is another thing claiming somebody is signed in.
  for (const name of [TOKEN_COOKIE, SESSION_COOKIE, WORKSPACE_COOKIE, "oqim_uid"]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
