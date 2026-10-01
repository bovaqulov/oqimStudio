import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { buildApiReference } from "@/features/docs/api-reference";
import { DocsBlockView } from "@/features/docs/components/DocsBlocks";
import { API_BASE_URL } from "@/lib/api/server";

export const metadata = {
  title: "API hujjatlari · Oqim Studio",
  description: "Oqim Studio ochiq API'si: kalit, doiralar, oltita endpoint va xatolar.",
};

/**
 * The whole `/api/v1/` reference, on one page.
 *
 * ## Why one page and not `/docs/<slug>` like `/help`
 *
 * Because the audiences are different in the one way that decides this. A help
 * guide is read once, start to finish, by somebody building their first bot —
 * splitting those into articles is right, and a reader who has finished one is
 * done. A reference is not read; it is searched. Somebody comes here holding a
 * `403` and needs the scope table, then the endpoint two sections down, and
 * Ctrl+F is the fastest route to both.
 *
 * The second reader settles it. This product deliberately ships no OpenAPI
 * file, so for a model being pointed at "the API docs" this page *is* the
 * specification — and a specification spread over seven URLs is one a model
 * fetches one seventh of. One page, one fetch, everything in it.
 *
 * ## Static, and reading nothing
 *
 * No session, no tenant, no repository — only the base URL out of the server's
 * own configuration, so that the address in the samples is this installation's
 * rather than one somebody wrote down once. That also means there is nothing
 * here for `check:effects` to worry about: the page reads a string and renders,
 * and the only thing on it that acts is the copy button, which is a click.
 */
export default function DocsPage() {
  const sections = buildApiReference(API_BASE_URL);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "API hujjatlari" }]}
        title="API hujjatlari"
        subtitle="Oqim Studio ochiq API'si — /api/v1/"
      />

      <PageBody maxWidth={760}>
        <div className="flex flex-col gap-7 pb-6">
          <p className="t-body t-secondary m-0 px-1">
            {
              "Bu sahifa dasturchi va AI uchun. Har bir misol nusxa olib, o'zgartirmasdan ishga tushiriladigan " +
              "qilib yozilgan; har bir maydon nomi, holat kodi va xato matni ishlab turgan serverdan olingan."
            }
          </p>

          {/*
            A contents list, because this page is long on purpose. Plain
            fragment anchors and not `<Link>`: there is nothing to navigate to,
            the target is on this page, and the router would only take a
            round trip to decide the same thing.
          */}
          <ListGroup title="Bo'limlar" inset="icon">
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="oq-row">
                <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
                  <Icon name={section.icon} size={17} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-headline truncate">{section.title}</span>
                  <span className="t-footnote t-secondary line-clamp-1">{section.summary}</span>
                </span>
                <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
              </a>
            ))}
          </ListGroup>

          {sections.map((section) => (
            // `scroll-mt` because the header is a floating capsule on a phone
            // and a welded bar from `md:` up — an anchor that lands flush with
            // the top of the scroller lands under both.
            <section key={section.id} id={section.id} className="flex scroll-mt-24 flex-col gap-3">
              <div className="flex flex-col gap-1 px-1 pt-2">
                <h2 className="t-title2 m-0">{section.title}</h2>
                <p className="t-footnote t-secondary m-0">{section.summary}</p>
              </div>

              {section.blocks.map((block, index) => (
                <DocsBlockView key={index} block={block} />
              ))}
            </section>
          ))}
        </div>
      </PageBody>
    </>
  );
}
