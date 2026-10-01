import { redirect } from "next/navigation";

/**
 * The root path has no screen of its own yet.
 *
 * Signed-out visitors never reach this: the route guard sends them to the
 * sign-in screen without a "you were turned away" notice (see `proxy.ts`).
 * Everyone who does reach it has a session, and the dashboard is what they
 * came for.
 */
export default function RootPage() {
  redirect("/dashboard");
}
