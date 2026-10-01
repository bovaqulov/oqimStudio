"use client";

import { useRouter, usePathname } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";

type Section = "bot" | "payments" | "code" | "settings";

/**
 * The bot's sections — and the only navigation row on the screen.
 *
 * There used to be three stacked bars above the first flow: this one, the
 * module bar under it, and a toolbar of counts and create-buttons under that.
 * A phone opening a bot saw a hundred and twenty pixels of chrome before the
 * thing it came for. The module bar moved into Sozlamalar (a bot has one
 * everyday surface and four that are picked once), the toolbar's contents
 * became a section heading and the MainButton, and what is left is one iOS
 * segmented control.
 *
 * "Bot" owns two URLs — its own and every `/modules/<key>` page a saved link
 * may point at — which is why the section is worked out here rather than by
 * matching a single prefix.
 */
export function BotTabs({ botId }: { botId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/bots/${botId}`;

  const value: Section =
    pathname === `${base}/payments`
      ? "payments"
      : pathname === `${base}/code`
        ? "code"
        : pathname === `${base}/settings`
          ? "settings"
          : "bot";

  return (
    <Segmented<Section>
      // The section strip belongs to the chrome, not to the page: it floats
      // clear of the edges on its own glass and the flow list scrolls under it.
      variant="island"
      label="Bot bo'limlari"
      value={value}
      onChange={(next) => {
        router.push(next === "bot" ? base : `${base}/${next}`);
      }}
      options={[
        { value: "bot", label: "Bot" },
        // «Guruhlar» was a fifth segment here and is now a panel at the top of
        // Sozlamalar. Four fit a phone without the strip scrolling.
        { value: "payments", label: "To'lovlar" },
        { value: "code", label: "Kod" },
        { value: "settings", label: "Sozlamalar" },
      ]}
    />
  );
}
