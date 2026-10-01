import { permanentRedirect } from "next/navigation";

/**
 * There is no workspace-wide agent list any more.
 *
 * An agent belongs to a project, and it is listed on that project's
 * «Resurslar» tab beside the bots it answers on. A second door that opened on
 * every agent in the account at once is the door that taught the flat shape
 * the project layer exists to correct — the same argument the sidebar makes
 * about bots (`components/layout/nav-config.ts`).
 *
 * A redirect and not a deleted route: this was a sidebar entry for long enough
 * to be bookmarked, and it is where the flow editor's agent field still points
 * an author who has no agent yet. A 404 would read as agents having been
 * removed from the product, which is not what happened to them — they moved
 * one level in, and `/projects` is where that level is chosen.
 */
export default async function AgentsPage() {
  permanentRedirect("/projects");
}
