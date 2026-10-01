import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { GUIDES, getGuide } from "../guides";

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getGuide((await params).slug);
  return { title: guide ? `${guide.title} · Yordam · Oqim Studio` : "Yordam · Oqim Studio" };
}

/**
 * One guide, as numbered steps.
 *
 * Static text and nothing else — no session, no tenant, no repository — so it
 * opens instantly and reads the same for everybody. The steps link into the
 * screens they describe, because a guide read three screens away from the work
 * is a guide nobody finishes.
 *
 * This is the one kind of screen in the app that is *allowed* paragraphs: it
 * is documentation, and a step whose body is cut to a label stops being an
 * instruction. So the pass here is on the frame rather than the words — step
 * bodies at reading size (17px, not 12), hairlines instead of outlines, the
 * "what next" grid folded into a list, and the tracked-out uppercase captions
 * gone.
 */
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const others = GUIDES.filter((item) => item.slug !== guide.slug);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Yordam markazi", href: "/help" }, { label: guide.title }]}
        title={guide.title}
      />

      <PageBody maxWidth={640}>
        <div className="flex flex-col gap-6 pb-4">
          {/* No title of our own: the header above already prints it twice,
              once in the breadcrumb and once as the bar title. What is left is
              the one thing the header cannot say — how long this will take.
              The guide's `summary` is gone with it; it introduced an article
              the reader has already chosen to open. */}
          <p className="t-footnote t-secondary m-0 px-1 tabular-nums">
            {guide.steps.length} qadam · ~{guide.minutes} daqiqa
          </p>

          <Panel className="flex flex-col">
            {guide.steps.map((step, index) => (
              <div key={step.title} className="flex gap-3 border-b border-separator p-4 last:border-0">
                <span className="t-footnote flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-accent-700 font-semibold text-white tabular-nums">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="t-headline">{step.title}</div>
                  {/* Documentation, so the body stays a body: 17px, the size
                      everything else on the phone is read at. */}
                  <p className="t-body t-secondary m-0">{step.body}</p>
                  {step.code && (
                    // Its own scroll container, and that is the whole point of
                    // the element: a graph has lines nothing can wrap — a
                    // «not_subscribed» port inside four levels of indent — and
                    // without `overflow-x-auto` here that line widens the step,
                    // the panel and the page under it. The reader scrolls the
                    // block; the page never moves sideways.
                    //
                    // Smaller than the 17px body on purpose, and back up again
                    // on a phone: this is the one thing on the page read
                    // character by character rather than as a sentence, so the
                    // number of columns that fit matters more than the ink.
                    <pre className="my-1 overflow-x-auto rounded-[10px] border border-separator bg-neutral-900 p-3 font-mono text-[12.5px] leading-relaxed text-neutral-200 max-md:text-[13px]">
                      {step.code}
                    </pre>
                  )}
                  {step.href && (
                    <Link
                      href={step.href}
                      className="t-body flex min-h-11 items-center gap-1.5 text-accent-400"
                    >
                      {step.linkLabel ?? "Ochish"} <Icon name="arrow-right" size={15} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </Panel>

          {guide.notes && guide.notes.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="t-headline m-0 px-1">Yodda tuting</h2>
              <Panel className="flex flex-col gap-3 p-4">
                {guide.notes.map((note) => (
                  <p key={note} className="t-subhead t-secondary m-0 flex items-start gap-2.5">
                    <Icon name="info" size={17} className="mt-px flex-none text-neutral-600" />
                    <span className="min-w-0 flex-1">{note}</span>
                  </p>
                ))}
              </Panel>
            </section>
          )}

          <ListGroup title="Keyingi qo'llanmalar" inset="icon">
            {others.map((item) => (
              <Link key={item.slug} href={`/help/${item.slug}`} className="oq-row">
                <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
                  <Icon name={item.icon} size={17} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-headline truncate">{item.title}</span>
                  <span className="t-footnote t-secondary line-clamp-1">{item.summary}</span>
                </span>
                <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
              </Link>
            ))}
          </ListGroup>
        </div>
      </PageBody>
    </>
  );
}
