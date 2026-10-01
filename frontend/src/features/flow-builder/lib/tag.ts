import type { TagAction } from "@/features/flows";

export const TAG_ACTION_OPTIONS: { value: TagAction; label: string }[] = [
  { value: "add", label: "Belgi qo'shish" },
  { value: "remove", label: "Belgini olib tashlash" },
  { value: "set_variable", label: "Javobni saqlash" },
];

/** Human-readable one-liner for the canvas card — kept in sync with `node.text`. */
export function summarizeTagAction(action: TagAction, name: string, value: string): string {
  if (!name) return "Nima saqlanishini yozing";
  if (action === "add") return `+ belgi: ${name}`;
  if (action === "remove") return `− belgi: ${name}`;
  return `${name} = ${value || "?"}`;
}
