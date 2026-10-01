import Link from "next/link";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ListGroup, ListLink } from "@/components/ui/List";
import { GUIDES } from "./guides";

interface HelpLink {
  title: string;
  href: string;
  icon: IconName;
  /** External docs open in a new tab; internal ones navigate in place. */
  external?: boolean;
}

/**
 * Shortcuts, not guides. These lead to a screen the reader already knows how
 * to use — the written instructions live in `GUIDES`, and mixing the two made
 * the whole page read as links pretending to be documentation.
 *
 * Each one used to carry a `detail` line under it ("Kim nima qila olishi:
 * egasi, admin, muharrir, analitik."). Six of those, plus six summaries, plus
 * a support paragraph, was most of this page's height — and none of them
 * changed which row the reader pressed. A row that says "Jamoa va rollar" and
 * goes to the team screen has already said everything it can.
 */
const SHORTCUTS: { section: string; links: HelpLink[] }[] = [
  {
    section: "Ish maydoni",
    links: [
      { title: "Shablondan boshlash", href: "/market", icon: "storefront" },
      { title: "Jamoa va rollar", href: "/settings/team", icon: "users-three" },
      { title: "Limitlar va tarif", href: "/billing/usage", icon: "chart-bar" },
    ],
  },
  {
    section: "Telegram hujjatlari",
    links: [
      { title: "Bot API", href: "https://core.telegram.org/bots/api", icon: "file-text", external: true },
      { title: "Telegram Payments", href: "https://core.telegram.org/bots/payments", icon: "receipt", external: true },
      { title: "Telegram Business", href: "https://core.telegram.org/bots/business", icon: "user-circle", external: true },
    ],
  },
];

/** The one place "qanday qilinadi?" leads to, linked from every error state and the header. */
export default function HelpPage() {
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Yordam markazi" }]} title="Yordam markazi" />

      <PageBody maxWidth={640}>
        <div className="flex flex-col gap-6 pb-4">
          <ListGroup title="Qo'llanmalar" inset="icon">
            {GUIDES.map((guide) => (
              <Link key={guide.slug} href={`/help/${guide.slug}`} className="oq-row">
                <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
                  <Icon name={guide.icon} size={17} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-headline truncate">{guide.title}</span>
                  {/* One line of summary, clamped. The "N qadam · ~M daqiqa"
                      meter that used to sit under it is on the guide itself,
                      where it is the answer to "how long is this". */}
                  <span className="t-footnote t-secondary line-clamp-1">{guide.summary}</span>
                </span>
                <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
              </Link>
            ))}
          </ListGroup>

          {SHORTCUTS.map((group) => (
            <ListGroup key={group.section} title={group.section} inset="icon">
              {group.links.map((link) =>
                link.external ? (
                  <a key={link.title} href={link.href} target="_blank" rel="noreferrer" className="oq-row">
                    <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400">
                      <Icon name={link.icon} size={17} />
                    </span>
                    <span className="t-body min-w-0 flex-1 truncate">{link.title}</span>
                    <Icon name="link" size={17} className="flex-none text-neutral-600" />
                  </a>
                ) : (
                  <ListLink key={link.title} href={link.href} icon={link.icon} label={link.title} />
                ),
              )}
            </ListGroup>
          ))}

          {/* The escape hatch, last, the way iOS Settings puts "Contact us" at
              the bottom. The paragraph that used to frame it ("Javob
              topolmadingizmi? Telegram orqali yozing — ish kunlari…") is down
              to the hours themselves, which is the only part that changes what
              the reader does. */}
          <ListGroup title="Yordam" inset="icon">
            <a href="https://t.me/oqimstudio_support" target="_blank" rel="noreferrer" className="oq-row">
              <span className="flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white">
                <Icon name="telegram-logo" size={17} />
              </span>
              <span className="t-body min-w-0 flex-1 truncate">Qo&apos;llab-quvvatlash</span>
              <span className="t-body t-secondary flex-none tabular-nums">09:00–18:00</span>
              <Icon name="link" size={17} className="flex-none text-neutral-600" />
            </a>
          </ListGroup>
        </div>
      </PageBody>
    </>
  );
}
