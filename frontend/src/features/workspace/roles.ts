import type { MemberRole, RoleDefinition } from "./types";

/** Every role the product offers, weakest last. Registering a new one is an entry here and nothing else. */
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: "owner",
    label: "Egasi",
    description: "To'liq huquq: tarif, to'lov, a'zolar va o'chirish.",
    tone: "accent",
    rank: 40,
  },
  {
    key: "admin",
    label: "Admin",
    description: "Botlar, oqimlar va a'zolarni boshqaradi. To'lovga tegmaydi.",
    tone: "success",
    rank: 30,
  },
  {
    key: "editor",
    label: "Muharrir",
    description: "Oqim quradi va tahrirlaydi, sozlamalarni o'zgartirmaydi.",
    tone: "neutral",
    rank: 20,
  },
  {
    key: "analyst",
    label: "Analitik",
    description: "Faqat ko'rish: analitika va hisobotlar.",
    tone: "neutral",
    rank: 10,
  },
];

export function getRoleDefinition(role: MemberRole): RoleDefinition {
  const found = ROLE_DEFINITIONS.find((definition) => definition.key === role);
  if (!found) throw new Error(`Unknown role: ${role}`);
  return found;
}

/** Whether `actor` outranks `target` — the one check every member-management control asks. */
export function outranks(actor: MemberRole, target: MemberRole): boolean {
  return getRoleDefinition(actor).rank > getRoleDefinition(target).rank;
}

/** Roles allowed to change workspace settings, billing and membership. */
export function canManageWorkspace(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

/** Roles allowed to create and edit bots and flows. */
export function canEditContent(role: MemberRole): boolean {
  return role !== "analyst";
}
