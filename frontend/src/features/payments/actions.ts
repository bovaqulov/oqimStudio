"use server";

import { revalidatePath } from "next/cache";
import { botsRepository } from "@/features/bots";
import { canManageWorkspace } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { paymentsRepository } from "./data/payments-repository";
import type { ConnectProviderState } from "./form-state";
import { customProvider, getPaymentProvider, isCustomProviderId } from "./providers";
import { validateProviderToken } from "./validate";

/**
 * Stores a provider token after checking it — shape first (cheap, precise
 * errors), then the provider itself through the repository. The token is read
 * from the form and never returned: the dialog only learns whether it worked.
 */
export async function connectPaymentProviderAction(
  _prev: ConnectProviderState,
  formData: FormData,
): Promise<ConnectProviderState> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) {
    return { status: "error", message: "To'lov provayderini ulash uchun admin huquqi kerak." };
  }

  const botId = String(formData.get("botId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const token = String(formData.get("token") ?? "");

  // The catalogue holds Stars and nothing else; every other connection is one
  // the merchant named, so the *shape* is what is checked. See
  // `isCustomProviderId` for why that replaced the lookup rather than joining it.
  const provider =
    getPaymentProvider(providerId) ?? (isCustomProviderId(providerId) ? customProvider(providerId) : undefined);
  if (!provider) return { status: "error", message: "To'lov tizimi nomi noto'g'ri." };
  if (provider.auth === "bot_token") {
    return { status: "error", message: `${provider.name} token talab qilmaydi — uni oddiy yoqish kifoya.` };
  }

  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) return { status: "error", message: "Bot topilmadi." };

  const invalid = validateProviderToken(providerId, token);
  if (invalid) return { status: "error", message: invalid };

  const connection = await paymentsRepository.connect({
    workspaceId: workspace.id,
    botId,
    providerId,
    token: token.trim(),
  });

  revalidatePath(`/bots/${botId}/payments`);
  if (connection.status.tone !== "success") {
    return { status: "error", message: connection.error ?? "Tokenni tekshirib bo'lmadi." };
  }
  return { status: "success", message: `${provider.name} ulandi (${connection.mode === "live" ? "LIVE" : "TEST"}).` };
}

/**
 * Switches on a provider that needs no token of its own (Telegram Stars).
 * Same repository call as a token connection — the difference is only that
 * there is nothing to store, so the flow is one click instead of a dialog.
 */
export async function enablePaymentProviderAction(formData: FormData): Promise<void> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return;

  const botId = String(formData.get("botId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const provider = getPaymentProvider(providerId);
  if (!provider || provider.auth !== "bot_token") return;

  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) return;

  await paymentsRepository.connect({ workspaceId: workspace.id, botId, providerId, token: null });
  revalidatePath(`/bots/${botId}/payments`);
}

export async function disconnectPaymentProviderAction(formData: FormData): Promise<void> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return;

  const botId = String(formData.get("botId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  if (!botId || !providerId) return;

  await paymentsRepository.disconnect(workspace.id, botId, providerId);
  revalidatePath(`/bots/${botId}/payments`);
}

export async function verifyPaymentProviderAction(formData: FormData): Promise<void> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return;

  const botId = String(formData.get("botId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  if (!botId || !providerId) return;

  await paymentsRepository.verify(workspace.id, botId, providerId);
  revalidatePath(`/bots/${botId}/payments`);
}
