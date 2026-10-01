"use client";

import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";

type Section = "plans" | "usage";

/**
 * The billing screen's two sections, as the same floating strip every other
 * section switcher in the product uses.
 *
 * It was the last `UnderlineTabs` on a phone-visible screen — an underline is a
 * desktop idiom that gives a 2px target edge and no fill to aim at.
 */
export function BillingTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const value: Section = pathname.startsWith("/billing/usage") ? "usage" : "plans";

  return (
    <Segmented<Section>
      variant="island"
      label="To'lov bo'limlari"
      value={value}
      onChange={(next) => router.push(next === "usage" ? "/billing/usage" : "/billing")}
      options={[
        { value: "plans", label: "Tariflar" },
        { value: "usage", label: "Limitlar" },
      ]}
    />
  );
}
