import { canEditContent, getRoleDefinition } from "@/features/workspace/roles";
import type { MemberRole } from "@/features/workspace/types";

/**
 * Who may mint and revoke a key — one answer, read by the screen and by the
 * action, so the button and the server can never disagree about it.
 *
 * `canEditContent` and not a rule of its own: a key authenticates as the
 * workspace rather than as a person, and the weakest of the four scopes still
 * hands a caller every contact the workspace has. That is squarely above what
 * an analyst — "faqat ko'rish" — is trusted with, and squarely inside what an
 * editor already does every day by wiring a flow to an external service.
 *
 * The owner/admin line was the other candidate and it is the wrong one: it
 * would put the person building the integration on one side of it and the
 * person who has to approve their credential on the other, and integrations
 * that need an approval queue get built with somebody's personal token
 * instead — which is the failure this whole screen exists to remove.
 */
export function canManageApiKeys(role: MemberRole): boolean {
  return canEditContent(role);
}

/**
 * Why not, in the words the reader gets — never a hidden button.
 *
 * A control that vanishes leaves somebody deciding whether the feature exists,
 * whether the page is broken, or whether they are looking in the wrong place.
 * A control that is visible, disabled and accompanied by this sentence leaves
 * them with one thing to do: ask the person whose role is above theirs.
 */
export function apiKeyRefusal(role: MemberRole): string {
  return (
    "API kaliti ish maydonidagi barcha ma'lumotga ochiq eshik, shuning uchun uni faqat tahrirlash " +
    `huquqi borlar yaratadi va bekor qiladi. Sizning rolingiz — ${getRoleDefinition(role).label}.`
  );
}
