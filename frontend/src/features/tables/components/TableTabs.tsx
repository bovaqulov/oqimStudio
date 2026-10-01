"use client";

import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/Segmented";

type Section = "rows" | "columns" | "integrations" | "settings";

/**
 * The table's four sections, in the same island strip a project and a bot use.
 *
 * Rows first because that is what a table is for; the columns behind it are
 * edited once and then rarely.
 *
 * «Integratsiyalar» was carved out of Sozlamalar. Two different jobs had been
 * sharing that screen: renaming a table and deleting it are things its owner
 * does, while the handle a flow addresses it by and the URL another system
 * posts into are things somebody wires up once, with a second window open. The
 * strip scrolls sideways when a fourth segment does not fit, so this costs a
 * phone nothing.
 */
export function TableTabs({ tableId }: { tableId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/tables/${tableId}`;

  const value: Section =
    pathname === `${base}/columns`
      ? "columns"
      : pathname === `${base}/integrations`
        ? "integrations"
        : pathname === `${base}/settings`
          ? "settings"
          : "rows";

  return (
    <Segmented<Section>
      variant="island"
      label="Ma'lumot bo'limlari"
      value={value}
      onChange={(next) => {
        router.push(next === "rows" ? base : `${base}/${next}`);
      }}
      options={[
        { value: "rows", label: "Qatorlar" },
        { value: "columns", label: "Ustunlar" },
        { value: "integrations", label: "Integratsiyalar" },
        { value: "settings", label: "Sozlamalar" },
      ]}
    />
  );
}
