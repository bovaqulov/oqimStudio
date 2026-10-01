import { AUTH_COPY } from "./messages";
import { isPasswordAcceptable } from "./password";

/** Deliberately permissive: the server (later) is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FieldErrors<T extends string> = Partial<Record<T, string>>;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return AUTH_COPY.errors.required;
  if (!EMAIL_PATTERN.test(email)) return AUTH_COPY.errors.emailFormat;
  return null;
}

export function validatePassword(value: string, { strict = false }: { strict?: boolean } = {}): string | null {
  if (!value) return AUTH_COPY.errors.required;
  // Login only checks that something was typed — telling a returning user their
  // existing password is "weak" helps nobody.
  if (!strict) return null;
  if (value.length < 8) return AUTH_COPY.errors.passwordShort;
  if (!isPasswordAcceptable(value)) return AUTH_COPY.errors.passwordWeak;
  return null;
}

export function validateConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return AUTH_COPY.errors.required;
  if (password !== confirmation) return AUTH_COPY.errors.passwordMismatch;
  return null;
}

export function validateName(value: string): string | null {
  const name = value.trim();
  if (!name) return AUTH_COPY.errors.required;
  if (name.length < 2) return AUTH_COPY.errors.nameShort;
  return null;
}

/**
 * What an invite code actually is: `secrets.token_hex(8)`, so sixteen hex
 * characters, lower case — see `Invite.code` in `apps/workspaces/models.py`.
 *
 * It is written down here because the pattern that used to stand in its place
 * was `^[A-Z]{3,6}-\d{3,6}$`, an invented shape nothing has ever minted. The
 * placeholder said "OQIM-1234" and the team screen handed out
 * `/join/a5224ecb16c075b6`, so the only codes the form accepted were the ones
 * that did not exist, and every real one was refused before it reached the
 * server. The field also upper-cased what was typed into it, which would have
 * broken the lookup even if the pattern had let it through.
 */
const INVITE_CODE_PATTERN = /^[0-9a-f]{16}$/;

/**
 * The code, out of whatever was pasted.
 *
 * People paste the link, because the link is what they were sent — and the link
 * is the *only* thing they were sent, since the team screen never shows the
 * bare code anywhere. Asking them to edit a URL down to its last segment is
 * asking them to do a job this line can do.
 */
export function normalizeInviteCode(value: string): string {
  const trimmed = value.trim();
  const fromLink = /\/join\/([^/?#\s]+)/.exec(trimmed);
  return (fromLink?.[1] ?? trimmed).trim().toLowerCase();
}

export function validateInviteCode(value: string): string | null {
  const code = normalizeInviteCode(value);
  if (!code) return AUTH_COPY.errors.required;
  if (!INVITE_CODE_PATTERN.test(code)) return AUTH_COPY.errors.codeFormat;
  return null;
}

export function validateWorkspaceName(value: string): string | null {
  const name = value.trim();
  if (!name) return AUTH_COPY.errors.required;
  if (name.length < 2) return AUTH_COPY.errors.workspaceName;
  return null;
}
