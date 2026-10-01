import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Where a phone's back button goes.
 *
 * The trail is drawn only from `md:` up, but it is still the one thing a screen
 * says about where it sits — so below `md` the header reads it instead of
 * printing it. The last crumb is this page; the nearest one above it that names
 * a destination is its parent, and a trail with no such crumb yields nothing
 * rather than a chevron pointing at a guess.
 *
 */
export async function backTarget(items?: BreadcrumbItem[]): Promise<{ label: string; href: string } | null> {
  if (!items || items.length < 2) return null;
  const parent = items.slice(0, -1).findLast((item) => item.href);
  return parent?.href ? { label: parent.label, href: parent.href } : null;
}

export async function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const trail = items;

  // One crumb is not a path. Left alone it repeats the title printed directly
  // under it, which is how "Yordam markazi / Yordam markazi" happened.
  if (trail.length < 2 && !trail.some((item) => item.href)) return null;

  return (
    // `gap-y` and a hit box on every link: a 15px breadcrumb is a navigation
    // target nobody can reach with a thumb, and `oq-tap` widens it on a touch
    // screen without moving the row.
    // Hidden on a phone: the bottom tab bar already says which section this
    // is, the last crumb is the page title printed directly underneath, and
    // what the trail was actually for down there — getting back one level — is
    // now the header's own back button (`backTarget` above).
    <div className="t-footnote t-tertiary mb-0.5 hidden flex-wrap items-center gap-x-1 gap-y-0.5 md:flex">
      {trail.map((item, index) => {
        const isLast = index === trail.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1">
            {item.href && !isLast ? (
              <Link href={item.href} className="oq-tap relative text-accent-400">
                {item.label}
              </Link>
            ) : (
              <span className="t-secondary">{item.label}</span>
            )}
            {!isLast && <span className="text-neutral-700">/</span>}
          </span>
        );
      })}
    </div>
  );
}
