import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import type { DocsBlock } from "../types";
import { CodeBlock } from "./CodeBlock";

/**
 * The one renderer every block on the reference page goes through.
 *
 * Server-side and static: nothing here reads a session, a tenant or a
 * repository, so the page opens instantly and says the same thing to
 * everybody. Only `CodeBlock` crosses into the browser, and only because a
 * clipboard lives there.
 */

/*
 * Two inline markers and no more: a backtick makes a code span, a double
 * asterisk makes bold. A third would be the start of a markdown renderer, and
 * a markdown renderer is a dependency plus a sanitiser plus an argument about
 * which dialect — for a page whose emphasis is carried almost entirely by the
 * code blocks anyway.
 *
 * They do not nest, and the bold alternative excludes a backtick so that they
 * cannot appear to. Written as `**` around a code span once, the split matched
 * the outer pair and the reader was shown the backticks themselves — the one
 * failure a text renderer this small can still have, and the cheapest place to
 * make it impossible is the pattern.
 */
const INLINE = /(`[^`]+`|\*\*[^*`]+\*\*)/g;

const CODE_CLASS = "rounded-[5px] bg-neutral-800 px-1 py-px font-mono text-[0.9em] text-text";

function inline(text: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, index) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={index} className={CODE_CLASS}>
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={index} className="font-semibold text-text">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={index}>{part}</span>;
    });
}

/** Read-before-write, said in colour: a scope that can change a flow is not a scope that reads one. */
function scopeTone(scope: string) {
  return scope.endsWith(":write") ? "warning" : "neutral";
}

export function DocsBlockView({ block }: { block: DocsBlock }) {
  switch (block.kind) {
    case "text":
      // 17px, like the guide pages: this is documentation, and a body cut to
      // label size stops being readable prose.
      return <p className="t-body t-secondary m-0 px-1">{inline(block.body)}</p>;

    case "code":
      return <CodeBlock label={block.label} code={block.code} copyable />;

    case "response":
      return <CodeBlock label={block.label} code={block.code} />;

    case "endpoint":
      return (
        <div className="flex flex-col gap-1.5 px-1 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={block.method === "GET" ? "neutral" : "accent"}>{block.method}</Badge>
            <code className="font-mono text-[14px] break-all text-text">{block.path}</code>
            {/* No scope is a fact about this endpoint, so it is printed rather
                than left blank — a row with nothing where every other row has
                a badge reads as an omission. */}
            {block.scope === null ? (
              <Badge tone="success">doirasiz</Badge>
            ) : (
              <Badge tone={scopeTone(block.scope)}>{block.scope}</Badge>
            )}
          </div>
          <p className="t-subhead t-secondary m-0">{block.summary}</p>
        </div>
      );

    case "rows":
      return (
        <section className="flex flex-col gap-2">
          {block.title && <h3 className="t-footnote t-secondary m-0 px-4">{block.title}</h3>}
          <Panel className="flex flex-col">
            {block.rows.map((row) => (
              // Two lines rather than two columns. A parameter's explanation is
              // a sentence, and a sentence in the right-hand column of a 390px
              // screen is four words and an ellipsis.
              <div key={row.term} className="flex flex-col gap-1 border-b border-separator p-4 last:border-0">
                <code className="t-subhead self-start font-mono text-text">{row.term}</code>
                <p className="t-subhead t-secondary m-0">{inline(row.detail)}</p>
              </div>
            ))}
          </Panel>
        </section>
      );

    case "table":
      return (
        // The scroll container is the point: a table of error codes has cells
        // nothing can wrap, and without this the widest row widens the page.
        <Panel className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th
                    key={cell}
                    className="t-footnote t-secondary border-b border-separator px-3 py-2 font-normal whitespace-nowrap"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className="t-footnote t-secondary border-b border-separator px-3 py-2 align-top last:w-full"
                    >
                      {index === 0 ? (
                        <span className="whitespace-nowrap text-text">{inline(cell)}</span>
                      ) : (
                        inline(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      );

    case "note":
      // The same shape the guide pages use for "Yodda tuting" — one icon, one
      // sentence, no box of its own.
      return (
        <p className="t-subhead t-secondary m-0 flex items-start gap-2.5 px-1">
          <Icon name="info" size={17} className="mt-px flex-none text-neutral-600" />
          <span className="min-w-0 flex-1">{inline(block.body)}</span>
        </p>
      );

    case "link":
      return (
        <div className="oq-group" data-inset="icon">
          <Link href={block.href} className="oq-row">
            <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
              <Icon name={block.icon} size={17} />
            </span>
            <span className="t-body min-w-0 flex-1 truncate">{block.label}</span>
            <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
          </Link>
        </div>
      );
  }
}
