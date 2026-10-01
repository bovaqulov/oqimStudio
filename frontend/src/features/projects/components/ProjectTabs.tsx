"use client";

import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";

type Section = "resources" | "activity" | "settings";

/**
 * The project's three sections, as the iOS segmented control the rest of the
 * app navigates with (`BotTabs` is the same shape).
 *
 * It replaces an underlined tab row of 13px labels on a hairline — a desktop
 * pattern with no target worth tapping on a phone.
 */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  const value: Section =
    pathname === `${base}/activity` ? "activity" : pathname === `${base}/settings` ? "settings" : "resources";

  return (
    <Segmented<Section>
      // Same strip as the bot page's — a section switcher is a section
      // switcher wherever it appears.
      variant="island"
      label="Loyiha bo'limlari"
      value={value}
      onChange={(next) => {
        router.push(next === "resources" ? base : `${base}/${next}`);
      }}
      options={[
        { value: "resources", label: "Resurslar" },
        { value: "activity", label: "Faoliyat" },
        { value: "settings", label: "Sozlamalar" },
      ]}
    />
  );
}
