import type { Metadata } from "next";
import { WorkspaceOnboarding } from "@/features/auth/components/WorkspaceOnboarding";

export const metadata: Metadata = {
  title: "Ish maydoni · Oqim Studio",
  description: "Jamoaga qo'shilish yoki yangi ish maydoni yaratish.",
};

/**
 * One route, two arrivals. Without `add` this is the step somebody still owes
 * before the app has a tenant to show them; with it they came from the
 * workspace switcher to open a second one and already have somewhere to go
 * back to. The guard in `proxy.ts` reads the same flag to decide who may be
 * here at all, so the two answers cannot drift apart.
 */
export default async function WorkspaceOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const { add } = await searchParams;
  return <WorkspaceOnboarding adding={add === "1"} />;
}
