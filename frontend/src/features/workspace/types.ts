import type { Tone } from "@/components/ui/types";

/**
 * What a member may do inside one workspace. Ordered by power in
 * `ROLE_DEFINITIONS` — nothing in the product hands out a role above the one
 * held by the person doing the handing.
 */
export type MemberRole = "owner" | "admin" | "editor" | "analyst";

export interface RoleDefinition {
  key: MemberRole;
  label: string;
  description: string;
  tone: Tone;
  /** Higher wins. Used for "can this member edit that member" checks. */
  rank: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  /** BCP-47 tag the interface is rendered in for this person. */
  locale: string;
  /**
   * Telegram established this identity, which makes `email` the synthetic
   * `tg<id>@telegram.local` — plumbing rather than an address. The settings
   * screen shows the Telegram account instead of drawing that in a field
   * labelled "Email".
   */
  viaTelegram?: boolean;
  /** Without the `@`, and empty for an account that has not set one. */
  telegramUsername?: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
  /** An invitation that has been sent but not accepted yet. */
  invited?: boolean;
}

/**
 * One tenant. Every screen in the app reads its name, timezone and plan from
 * here — nothing about a particular company is written into a component.
 */
export interface Workspace {
  id: string;
  name: string;
  /** URL-safe handle, unique per install. */
  slug: string;
  planKey: string;
  /** IANA zone every schedule and timestamp in this workspace is read in. */
  timezone: string;
  locale: string;
  /** ISO-4217 code the plan and invoices are billed in. */
  currency: string;
  createdAt: string;
  ownerUserId: string;
  /**
   * True for the workspace `seed_demo` builds. Its numbers are invented, and a
   * screen showing them to a customer looks exactly like their own data — so
   * every screen that reports a figure says where it came from.
   */
  isDemo?: boolean;
}

/** Who is asking, and on behalf of which tenant. Resolved once per request. */
export interface Session {
  user: User;
  workspace: Workspace;
  /** The signed-in user's role *in this workspace*. */
  role: MemberRole;
  /** Every workspace this user belongs to — the switcher's contents. */
  memberships: Workspace[];
}

/**
 * A single-use invite, and the two ways to hand it to somebody.
 *
 * `url` is the one to paste anywhere; `telegramUrl` opens Telegram's own share
 * sheet with the chat picker up and the message already written, which is the
 * shape a team that talks in Telegram actually invites in — they know the chat,
 * not the mailbox.
 */
export interface WorkspaceInviteLink {
  code: string;
  role: MemberRole;
  url: string;
  telegramUrl: string;
  expiresAt: string;
}

/**
 * An invite, read without spending it.
 *
 * The join screen shows this and then asks; redeeming is the button, not the
 * page load. A GET that consumes a single-use code is consumed by whatever
 * fetches it first — a link prefetch, a double render, a refresh — and the
 * reader is then told their own link is invalid.
 */
export interface WorkspaceInvitePreview {
  code: string;
  role: MemberRole;
  workspaceName: string;
  /** False once it has been redeemed or has expired. */
  usable: boolean;
  /** They are already in: the screen says so instead of offering a dead button. */
  alreadyMember: boolean;
}
