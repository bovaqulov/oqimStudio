import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, INVITE_ROUTE, isSessionExpired, SESSION_COOKIE } from "@/features/auth/session-cookie";

/**
 * Route guard — Next 16 renamed this convention from `middleware` to `proxy`;
 * the function is the same one, run before a route renders.
 *
 * Reads the mock session cookie and decides three things: signed-out people
 * cannot open the app, signed-in people are not shown the login form again,
 * and someone mid-onboarding is sent to the step they still owe. When a real
 * backend lands, the cookie becomes httpOnly and signed — the rules below do
 * not change.
 */
const AUTH_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"];
const ONBOARDING_ROUTE = "/onboarding";

/**
 * The areas that need a session — named, not inferred.
 *
 * A guard that treats *everything* it does not recognise as protected turns
 * every typo into "please sign in first", which is a lie: `/bu-sahifa-yoq` was
 * never a page. Anything not listed here falls through to Next, which renders
 * the 404 the reader deserves.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/bots",
  "/flows",
  "/chats",
  "/contacts",
  "/analytics",
  "/agents",
  "/market",
  "/integrations",
  "/billing",
  "/settings",
  // An invite link is followed by somebody who may not be signed in yet, and
  // that is the point of listing it: the guard sends them to /login with this
  // as `next`, so the code survives the sign-in and is redeemed afterwards.
  INVITE_ROUTE,
  ONBOARDING_ROUTE,
];

/**
 * Where an account with no workspace yet is allowed to stand.
 *
 * Onboarding is the step it owes. `/join` is the other way out of that step,
 * and leaving it off is what made an invite unreachable for the one reader it
 * is written for: signing up *because* somebody invited you means having no
 * workspace, so the rule below caught the invite one line after the rule above
 * had gone to the trouble of carrying its code through the sign-in — and the
 * redirect to /onboarding/workspace does not carry it. The link handed them a
 * form to build the very workspace they were being let into.
 *
 * This is the order the two rules go in and not an exception to either: an
 * invite is read *before* "you have no workspace", because redeeming it is how
 * the workspace arrives.
 */
const WORKSPACELESS_ROUTES = [INVITE_ROUTE, ONBOARDING_ROUTE];

/** Paths people type from memory that are not the name we gave the page. */
const ALIASES: Record<string, string> = {
  "/register": "/signup",
  "/sign-up": "/signup",
  "/sign-in": "/login",
  "/signin": "/login",
};

function matches(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isAuthRoute(pathname: string): boolean {
  return matches(pathname, AUTH_ROUTES);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const alias = ALIASES[pathname];
  if (alias) return NextResponse.redirect(new URL(alias, request.url));
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = decodeSession(raw);
  const expired = Boolean(raw) && isSessionExpired(session);
  const signedIn = Boolean(session) && !expired;

  /*
   * A server action posts to the URL of the page it was called from, so every
   * rule below is also applied to it — and a redirect is the one answer an
   * action call cannot use. Next expects a flight response; it gets 200 and the
   * HTML of somewhere else, and throws "An unexpected response was received
   * from the server" on the client, where it surfaces as a form that failed
   * for no stated reason.
   *
   * The steering rules are the ones that have to stand aside: "signed in, so
   * not the login page", "workspace already chosen, so not onboarding", "email
   * not verified yet". All three are about where a *reader* should be looking,
   * they can flip in the middle of the very action that flips them — joining a
   * workspace is exactly the case — and none of them is what keeps anybody out
   * of anything. Being signed out still stops here, below: an action from a
   * signed-out client has nothing to do anyway.
   */
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  // An account that is not finished yet keeps its escape hatches: /login and
  // /signup let someone switch accounts or start over. Bouncing them back to
  // the verification screen would leave no way out of it.
  const escapeHatch = pathname === "/login" || pathname === "/signup";
  if (signedIn && escapeHatch && !session!.emailVerified) return NextResponse.next();

  // Signed in and looking at the door: send them inside instead.
  if (signedIn && isAuthRoute(pathname) && !isServerAction) {
    const target = !session!.emailVerified
      ? `/verify-email?email=${encodeURIComponent(session!.email)}`
      : session!.workspaceId
        ? "/dashboard"
        : "/onboarding/workspace";
    // …unless they are already on the step they need.
    if (!pathname.startsWith(target.split("?")[0]!)) {
      return NextResponse.redirect(new URL(target, request.url));
    }
    return NextResponse.next();
  }

  // The front door. Signed out, it is the sign-in screen — with nothing to
  // explain, because nobody was turned away from anything: "Bu sahifa uchun
  // avval kirish kerak" as a first impression is an accusation.
  if (pathname === "/") {
    if (!signedIn) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  }

  // Not a page this guard is responsible for. Auth screens handle themselves
  // above; everything else is either public or does not exist, and Next says
  // which.
  if (isAuthRoute(pathname) || !matches(pathname, PROTECTED_PREFIXES)) return NextResponse.next();

  if (!signedIn) {
    const login = new URL("/login", request.url);
    // Expired says "your session ran out"; missing says "please sign in" — the
    // difference matters to someone who was working a minute ago.
    login.searchParams.set("reason", expired ? "expired" : "auth");
    if (pathname !== "/dashboard") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // Signed in, but the account is not finished yet.
  if (!session!.emailVerified && !pathname.startsWith("/verify-email") && !isServerAction) {
    return NextResponse.redirect(new URL(`/verify-email?email=${encodeURIComponent(session!.email)}`, request.url));
  }
  if (!session!.workspaceId && !matches(pathname, WORKSPACELESS_ROUTES) && !isServerAction) {
    return NextResponse.redirect(new URL("/onboarding/workspace", request.url));
  }
  // Onboarding is two things wearing one route: the step somebody still owes,
  // and the screen they reach on purpose from the workspace switcher to open a
  // second one. Only the first should bounce — a reader who asked for this
  // page by clicking "Yangi ish maydoni" is not stuck in anything, and sending
  // them to the dashboard makes that menu item look broken. `add` is what
  // tells the two apart, so it is set by the link and never by a redirect.
  const addingWorkspace = request.nextUrl.searchParams.get("add") === "1";
  if (session!.workspaceId && pathname.startsWith(ONBOARDING_ROUTE) && !addingWorkspace && !isServerAction) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, the API routes and static files.
  matcher: ["/((?!_next/static|_next/image|api|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
