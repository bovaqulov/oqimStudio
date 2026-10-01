/**
 * Shown the moment a nav link is clicked, for every page under the app shell.
 *
 * Without it the sidebar keeps the page you are leaving on screen until the
 * destination is ready, so a route that takes a moment to come back reads as a
 * frozen app. This paints the same header-and-body frame every page uses, so
 * the real content replaces a shape that is already in the right place rather
 * than arriving into a blank.
 */
function Bar({ width, height = 12 }: { width: string; height?: number }) {
  return <span className="block rounded bg-neutral-800/70" style={{ width, height }} />;
}

export default function AppLoading() {
  return (
    <>
      <header className="flex min-h-[52px] flex-none items-center gap-3 border-b border-separator bg-overlay/80 px-[18px]">
        <div className="flex flex-1 flex-col gap-1.5">
          <Bar width="140px" height={13} />
          <Bar width="96px" height={9} />
        </div>
        <span className="h-[26px] w-[26px] flex-none rounded-full bg-neutral-800/70" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-hidden px-[22px] pt-5 pb-[30px]">
          {/* One pulse over the whole frame rather than per shape — several
              blocks breathing out of step reads as noise, not as loading. */}
          <div className="flex animate-pulse flex-col gap-4" aria-hidden>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-[16px] border border-separator bg-surface p-3.5"
                >
                  <Bar width="60%" height={9} />
                  <Bar width="40%" height={18} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-3">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2.5 rounded-[16px] border border-separator bg-surface p-3.5"
                >
                  <Bar width="70%" height={12} />
                  <Bar width="45%" height={9} />
                  <Bar width="100%" height={28} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only" role="status">
        Yuklanmoqda…
      </span>
    </>
  );
}
