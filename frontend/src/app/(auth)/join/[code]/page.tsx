import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AuthCard } from "@/features/auth/components/AuthCard";
import { acceptInviteAction } from "@/features/workspace/actions";
import { getRoleDefinition } from "@/features/workspace/roles";
import { workspacesRepository } from "@/features/workspace/data/workspaces-repository";

export const metadata = {
  title: "Taklif · Oqim Studio",
};

/**
 * The way out of this screen, at the same 44px target every other auth link
 * keeps. Spelled here rather than imported from `AuthCard`: this page is a
 * server component and that module is `"use client"`, so its non-component
 * exports arrive as client references rather than as the strings they are.
 */
const LINK_CLASS =
  "oq-press t-subhead inline-flex min-h-11 cursor-pointer items-center rounded-[8px] px-1 text-accent-400";

/**
 * The end of an invite link: what is on offer, and a button that accepts it.
 *
 * A route of its own rather than the onboarding screen with the code
 * pre-filled: that screen belongs to somebody who has no workspace yet and
 * bounces anybody else back to the dashboard — which is exactly the reader an
 * invite is usually sent to. This one accepts both.
 *
 * **It reads here and joins on the button, and the split is the whole point.**
 * The first version redeemed during render, on the theory that the reader had
 * already pressed a button — the link — and a second one would be the product
 * asking whether they meant to open what they just opened. That was wrong for a
 * reason that has nothing to do with intent: the code is single use, so
 * whatever fetches the page first spends it. A link prefetch, a double render
 * in development, a refresh — any of them consumed the invite, and the screen
 * that finally drew told the reader their own link was invalid. It did, by
 * then. Reading is a GET and changes nothing; joining is a POST.
 *
 * Signing in first is the route guard's job (`proxy.ts` sends a signed-out
 * visitor to `/login?next=…`), so by the time this renders there is an account
 * to attach the membership to.
 *
 * **In the auth group rather than the app shell**, which is what finally made
 * the link reach the reader it is written for. That reader has no workspace —
 * they signed up because they were invited — and every piece of app chrome
 * opens by calling `getSession()`, which sends exactly that account to
 * /onboarding/workspace and drops the code doing it. Fixing the route guard
 * alone bought one component's worth of progress and the layout undid it. A
 * member who already belongs somewhere loses the sidebar for this one screen
 * and keeps the way back at the bottom of it.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await workspacesRepository.previewInvite(code);

  const problem = !invite
    ? "Bunday taklif kodi topilmadi. Kodni admindan qayta so'rang."
    : invite.alreadyMember
      ? null
      : !invite.usable
        ? "Bu havola allaqachon ishlatilgan yoki muddati tugagan. Admindan yangisini so'rang."
        : null;

  const home = (
    <Link href="/dashboard" className={LINK_CLASS}>
      Bosh sahifaga
    </Link>
  );

  if (problem) {
    return (
      <AuthCard title="Havola ishlamadi" footer={home}>
        <Badge tone="warning" icon="warning" />
        <p className="t-subhead t-secondary m-0">{problem}</p>
      </AuthCard>
    );
  }

  if (invite!.alreadyMember) {
    return (
      <AuthCard title={"Siz allaqachon a'zosiz"} footer={home}>
        <Badge tone="success" icon="check-circle" />
        <p className="t-subhead t-secondary m-0">
          «{invite!.workspaceName}» ish maydonida siz bor ekansiz — havola kerak emas.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`«${invite!.workspaceName}» ish maydoniga taklif`} footer={home}>
      <Badge tone="accent" icon="users-three" />
      {/* The role is said before the button, not after: it is the one thing
          about this invitation the reader cannot see anywhere else, and it
          decides what they will be able to do inside. */}
      <p className="t-subhead t-secondary m-0">Rolingiz: {getRoleDefinition(invite!.role).label}</p>
      <form action={acceptInviteAction} className="pt-4">
        <input type="hidden" name="code" value={invite!.code} />
        <button
          type="submit"
          className="oq-press t-body flex min-h-12 w-full cursor-pointer items-center justify-center rounded-[12px] bg-accent-700 px-5 text-white"
        >
          Qo&apos;shilish
        </button>
      </form>
    </AuthCard>
  );
}

/** Which of the three answers this is, said by a glyph before the sentence says it. */
function Badge({
  tone,
  icon,
}: {
  tone: "warning" | "success" | "accent";
  icon: "warning" | "check-circle" | "users-three";
}) {
  const tones = {
    warning: "bg-warning-bg text-warning-fg",
    success: "bg-success-bg text-success-fg",
    accent: "bg-accent-900 text-accent-200",
  };
  return (
    <span className={`mb-3 flex h-14 w-14 items-center justify-center rounded-full ${tones[tone]}`}>
      <Icon name={icon} size={26} />
    </span>
  );
}
