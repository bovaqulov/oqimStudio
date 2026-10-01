"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/server";
import { getSession } from "@/features/workspace/session";
import { apiKeysRepository } from "./data/apikeys-repository";
import { apiKeyRefusal, canManageApiKeys } from "./permissions";
import { isApiKeyScope } from "./scopes";
import type { ApiKeyScope, CreatedApiKey } from "./types";

/** The screen these two write to; both of them change what it lists. */
const SCREEN = "/settings/api-keys";

/** Longer than this is a sentence, not a name, and the list truncates it anyway. */
const MAX_NAME = 60;

/**
 * The gate, asked the same way by both writes.
 *
 * `permissions.ts` holds the rule and the sentence, and the screen reads the
 * same two — so a disabled button and a refused request can never give the
 * reader two different accounts of why. The check is repeated here and not
 * merely on the screen because a server action is a public endpoint: the button
 * being greyed out is a courtesy, this is the rule.
 */
async function requireEditor(): Promise<{ workspaceId: string } | { error: string }> {
  const session = await getSession();
  if (!canManageApiKeys(session.role)) return { error: apiKeyRefusal(session.role) };
  return { workspaceId: session.workspace.id };
}

/**
 * Mints a key and returns the credential.
 *
 * Returns rather than redirects, and the value never touches a URL, a cookie or
 * a revalidated payload: the secret exists in exactly one HTTP response from
 * Django, is handed straight to the component that draws it, and lives in that
 * component's state until the sheet closes. A `redirect` carrying it in a query
 * string would put it in the browser's history, in the server log and in
 * whatever the reader pastes when they later ask for help.
 *
 * Unknown scopes are dropped rather than forwarded. The four are the contract;
 * a fifth arriving here came from a tampered payload, not from the form.
 */
export async function createApiKeyAction(input: {
  name: string;
  scopes: string[];
}): Promise<{ key: CreatedApiKey } | { error: string }> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;

  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) return { error: "Kalitga nom bering — ro'yxatda uni faqat shu nom bilan taniysiz." };

  const scopes = input.scopes.filter(isApiKeyScope) as ApiKeyScope[];
  if (scopes.length === 0) return { error: "Kamida bitta ruxsatni belgilang." };

  try {
    const key = await apiKeysRepository.create({ workspaceId: gate.workspaceId, name, scopes });
    revalidatePath(SCREEN);
    return { key };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("createApiKeyAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Kalit yaratilmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
}

/**
 * Revokes one. Called from a button that has already asked, and asks nothing
 * itself — the confirmation belongs next to the name the reader is looking at,
 * not here where the only thing in hand is an id.
 *
 * A failure comes back as a sentence. Silence on a revoke is the worst answer
 * available: the reader believes a leaked credential is dead when it is not.
 */
export async function revokeApiKeyAction(input: { keyId: string }): Promise<{ error?: string }> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.keyId) return { error: "Kalit topilmadi." };

  try {
    await apiKeysRepository.revoke(gate.workspaceId, input.keyId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("revokeApiKeyAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Kalit bekor qilinmadi. Birozdan so'ng urinib ko'ring.",
    };
  }
  revalidatePath(SCREEN);
  return {};
}
