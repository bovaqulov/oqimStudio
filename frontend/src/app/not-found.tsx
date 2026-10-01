import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * The 404 screen, for every route in the app.
 *
 * Placed at the root rather than per section: an unknown path is unknown
 * everywhere, and a reader who mistyped a URL should get an answer that says
 * so — not the last screen that happened to match, which reads as the app
 * being broken.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-5 py-16">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
          <Icon name="magnifying-glass" size={24} />
        </span>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] tracking-[.12em] text-neutral-600 uppercase">404</div>
          <h1 className="text-[19px] font-medium text-text">Sahifa topilmadi</h1>
          <p className="text-[13px] leading-relaxed text-neutral-500">
            Bu manzilda hech narsa yo&apos;q. Havola eskirgan bo&apos;lishi yoki manzilda xato
            bo&apos;lishi mumkin.
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-md bg-accent-700 px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-600"
          >
            <Icon name="house" size={13} /> Bosh sahifaga qaytish
          </Link>
          <Link
            href="/help"
            className="rounded-md bg-neutral-800 px-3.5 py-2 text-[12.5px] text-neutral-300 hover:bg-neutral-700"
          >
            Yordam markazi
          </Link>
        </div>
      </div>
    </main>
  );
}
