"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/server";
import { getSession } from "@/features/workspace/session";
import { inboxRepository } from "./data/inbox-repository";

/**
 * An operator's answer.
 *
 * Returns the failure as a sentence rather than throwing it. Sending a message
 * has three ordinary ways to fail that are all the reader's business — the
 * person blocked the bot, the caller is an analyst, Telegram refused — and an
 * error boundary swallowing the chat to say "something went wrong" loses both
 * the reason and the draft.
 *
 * The permission is the backend's to enforce, and it does. This does not
 * second-guess it: one place deciding who may answer a customer is one place
 * that can be wrong about it.
 */
export async function sendReplyAction(input: {
  contactId: string;
  text: string;
}): Promise<{ ok: true } | { error: string }> {
  const text = input.text.trim();
  if (!text) return { error: "Xabar bo'sh." };

  const { workspace } = await getSession();
  try {
    await inboxRepository.sendReply(workspace.id, input.contactId, text);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("sendReplyAction failed", error);
    return {
      error: error instanceof ApiError ? error.message : "Xabar yuborilmadi. Birozdan so'ng urinib ko'ring.",
    };
  }

  // Both screens read this thread: the row in the list carries its last line.
  revalidatePath(`/chats/${input.contactId}`);
  revalidatePath("/chats");
  return { ok: true };
}
