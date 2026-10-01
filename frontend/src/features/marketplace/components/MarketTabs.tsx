"use client";

import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";

type Section = "all" | "mine";

/** The market's two lists, on the same segmented control the rest of the app navigates with. */
export function MarketTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const value: Section = pathname.startsWith("/market/mine") ? "mine" : "all";

  return (
    <Segmented<Section>
      // Same strip as the bot page's — a section switcher is a section
      // switcher wherever it appears.
      variant="island"
      label="Market bo'limlari"
      value={value}
      onChange={(next) => {
        router.push(next === "mine" ? "/market/mine" : "/market");
      }}
      options={[
        { value: "all", label: "Shablonlar" },
        // "Meniki" was read as "the ones I installed" — which is the other
        // possessive this screen could mean, and the more likely one for a
        // reader who has just installed something and is looking for it.
        // An installed template is not kept here at all: it becomes a flow.
        { value: "mine", label: "Nashrlarim" },
      ]}
    />
  );
}
