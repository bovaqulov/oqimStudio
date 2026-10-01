import { CommandPalette } from "@/components/layout/CommandPalette";
import { MobileNav } from "@/components/layout/MobileNav";
import { buildNavModel } from "@/components/layout/nav-config";
import { getProjectLayer } from "@/components/layout/project-layer";
import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceSummary } from "@/components/layout/WorkspaceSummary";
import { getPlanFor } from "@/features/billing/get-plans";
import { getSearchIndex } from "@/features/search/get-search-index";
import { getRoleDefinition, workspacesRepository } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { getLocale } from "@/lib/i18n/server";
import { dictionaryFor } from "@/lib/i18n/dictionaries";

/**
 * Chrome shared by every screen except the flow editor, which drops the
 * sidebar entirely for a full-bleed canvas (see src/app/flows/[flowId]).
 *
 * One navigation model, three shapes: the sidebar (desktop) and the drawer
 * behind the same component, the bottom tab bar plus its "Yana" sheet below
 * `md`. Both are fed from here so neither can fall behind the other.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const [locale, searchIndex, layer, members, plan] = await Promise.all([
    getLocale(),
    getSearchIndex(session.workspace.id),
    getProjectLayer(),
    workspacesRepository.listMembers(session.workspace.id),
    // The price list, for one word in the summary below. It is the same three
    // rows for every tenant and `getPlans` caches them per request, so the
    // screen underneath reads the row this fetches rather than a second copy.
    getPlanFor(session.workspace.id, session.workspace.planKey),
  ]);
  // The nav model is words, so it is built here, on the server, where the
  // reader's language is already resolved — see `buildNavModel`. The provider
  // that carries the same language to the client components lives one layout
  // up, in the root layout, with the singletons it also has to reach.
  const model = buildNavModel(layer.projects, dictionaryFor(locale));

  const summary = (
    <WorkspaceSummary
      workspace={session.workspace}
      memberships={session.memberships}
      memberCount={members.length}
      planName={plan?.name}
      roleLabel={getRoleDefinition(session.role).label}
    />
  );

  return (
    /*
     * `oq-viewport` is `--tg-viewport` (Telegram's `viewportStableHeight`) with
     * `100dvh` as the fallback. Two problems, one answer: a phone browser's own
     * bars eat into `vh`, and inside Telegram the on-screen keyboard covers the
     * bottom of the webview without resizing it — a tab bar fixed to `bottom: 0`
     * ends up underneath the keyboard. Sizing the shell to the stable height and
     * positioning the bar inside it means the bar rides up when the keyboard
     * opens.
     */
    <div className="oq-viewport oq-has-tabbar relative flex w-full overflow-hidden bg-bg text-text">
      <Sidebar model={model} summary={summary} />
      {/* The tab bar is drawn over the page, so the page has to end above it. */}
      <main className="oq-tabbar-inset flex min-w-0 flex-1 flex-col">
        {children}
      </main>
      <MobileNav model={model} summary={summary} />
      <CommandPalette items={searchIndex} />
    </div>
  );
}
