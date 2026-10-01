import type { IconName } from "@/components/ui/Icon";

/**
 * The shape of the API reference page.
 *
 * Content, not data — nothing here is per-tenant, so it never goes near a
 * repository. It is modelled as blocks rather than as free HTML for the reason
 * `help/guides.ts` is modelled as steps: the page has one renderer, so a
 * section cannot invent a layout of its own, and every code sample gets the
 * same copy button without anybody remembering to add one.
 */

export type ApiScope = "flows:read" | "flows:write" | "bots:read" | "contacts:read";

export type HttpMethod = "GET" | "POST" | "PUT";

/**
 * One thing on the page.
 *
 * `code` is a request somebody pastes into a terminal; `response` is what came
 * back. They are two kinds rather than one with a flag because only one of them
 * is worth copying, and a copy button on a response is a button that hands the
 * reader something they cannot run.
 */
export type DocsBlock =
  | { kind: "text"; body: string }
  | { kind: "code"; label: string; code: string }
  | { kind: "response"; label: string; code: string }
  /**
   * An endpoint's own header line: method, path, and the scope it needs.
   *
   * `null` is a real value here and not a missing one — `GET /me/` answers any
   * live key, and a row that simply omitted the scope would read as an
   * oversight rather than as the decision it is.
   */
  | { kind: "endpoint"; method: HttpMethod; path: string; scope: ApiScope | null; summary: string }
  /** Name-and-explanation pairs: query parameters, body fields, scopes. */
  | { kind: "rows"; title?: string; rows: { term: string; detail: string }[] }
  /** A grid where the first column is not the only thing worth aligning. */
  | { kind: "table"; head: string[]; rows: string[][] }
  /** One sentence the reader has to carry away from the section. */
  | { kind: "note"; body: string }
  /** Somewhere in the panel this section depends on. */
  | { kind: "link"; href: string; label: string; icon: IconName };

export interface DocsSection {
  /** The fragment the contents list jumps to. */
  id: string;
  title: string;
  /**
   * One line, on the contents list and under the heading.
   *
   * Plain text — this one string is *not* run through the inline parser, since
   * it renders inside a truncating row. A backtick written here reaches the
   * reader as a backtick, which is how it was caught.
   */
  summary: string;
  icon: IconName;
  blocks: DocsBlock[];
}
