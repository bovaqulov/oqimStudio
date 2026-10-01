"use server";

import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/server";
import { redirect } from "next/navigation";
import { projectsRepository } from "@/features/projects";
import { canEditContent, canManageWorkspace } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { botsRepository } from "./data/bots-repository";
import { scriptsRepository } from "./data/scripts-repository";
import { normalizeLanguages } from "./languages";
import type { BotSettingsState, ConnectBotState, ScriptLibraryState } from "./form-state";
import { validateBotToken } from "./lib/telegram-profile";
import type { ModuleKey } from "@/features/flows";
import type { BotChat, BotCreateRequest, BotCreateStatus, BotLanguages, WebhookCheck } from "./types";

/**
 * Hands the full token back to the caller. A server action rather than a page
 * prop: the credential leaves the server only when a signed-in member with
 * edit rights presses the button, and never sits in the page's HTML.
 */
export async function revealBotTokenAction(botId: string): Promise<string> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return "";
  return (await botsRepository.revealToken(workspace.id, botId)) ?? "";
}

/**
 * Reads the language switches back out of the form.
 *
 * A form with every language turned off is not a bot that answers nobody — it
 * is a reader who cannot edit, whose disabled inputs post nothing at all. What
 * is stored stands in that case, and `normalizeLanguages` puts the main
 * language back into the list either way.
 */
function readLanguages(formData: FormData, current: BotLanguages): BotLanguages {
  const enabled = formData.getAll("languages").map(String);
  return normalizeLanguages({
    main: String(formData.get("mainLanguage") ?? current.main),
    enabled: enabled.length ? enabled : current.enabled,
  });
}

export async function updateBotSettingsAction(
  _prev: BotSettingsState,
  formData: FormData,
): Promise<BotSettingsState> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: "Sozlamalarni o'zgartirish uchun huquq yo'q." };

  const botId = String(formData.get("botId") ?? "");
  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) return { status: "error", message: "Bot topilmadi." };

  const languages = readLanguages(formData, bot.settings.languages);

  try {
    await botsRepository.update(workspace.id, botId, {
      settings: {
        displayName: String(formData.get("displayName") ?? bot.settings.displayName).trim(),
        description: String(formData.get("description") ?? "").trim(),
        shortDescription: String(formData.get("shortDescription") ?? "").trim(),
        // One control on the screen decides what the bot speaks. This key
        // predates it and is kept in step rather than left behind as a second,
        // editable answer to the same question.
        language: languages.main,
        languages,
        avatarEmoji: String(formData.get("avatarEmoji") ?? bot.settings.avatarEmoji).slice(0, 4) || "🤖",
      },
      updatedAt: "hozir",
    });
  } catch (error) {
    // The settings screen used to swallow this: a PATCH that never landed left
    // the same values on screen as a PATCH that did.
    const message =
      error instanceof ApiError ? error.message : "Sozlamalar saqlanmadi — server javob bermadi.";
    if (!(error instanceof ApiError)) console.error("updateBotSettingsAction failed", error);
    return { status: "error", message };
  }

  revalidatePath(`/bots/${botId}/settings`);
  revalidatePath(`/bots/${botId}`);
  return { status: "saved", message: "Sozlamalar saqlandi", savedAt: Date.now() };
}

/**
 * Where a bot lands. Connecting a bot is one field, so the project is not a
 * question put to the user: the page that opened the form may name one — and
 * it is re-checked here, since a query parameter is not proof of anything —
 * otherwise the workspace's first project takes it, and a workspace with none
 * gets one rather than being sent away to create it first.
 *
 * That one is called «Mening loyiham» and not «Umumiy». The reader never asked
 * for it — it appears in the sidebar because they connected a bot — so its name
 * is the one thing telling them what it is. "Umumiy" reads as a category the
 * product came with, of the same kind as "Market" or "To'lov" above it, and a
 * category is not something anybody thinks to rename; "Mening loyiham" is
 * plainly theirs, and plainly a placeholder.
 */
async function resolveProjectId(workspaceId: string, requested: string, createdBy: string): Promise<string> {
  const asked = requested ? await projectsRepository.getById(workspaceId, requested) : undefined;
  if (asked) return asked.id;

  const [first] = await projectsRepository.list(workspaceId);
  if (first) return first.id;
  const created = await projectsRepository.create({
    workspaceId,
    name: "Mening loyiham",
    description: "Botlar uchun boshlang'ich loyiha",
    createdBy,
  });
  return created.id;
}

/**
 * Connects a bot from its token and nothing else.
 *
 * The shape of the token is checked here because it is free and exact; the two
 * questions that need an answer from outside — is this token real, and is it
 * already connected — are the backend's, which is also the only place that
 * talks to Telegram. It names the bot from `getMe`, which is why this form
 * asks for no name.
 */
export async function connectBotAction(_prev: ConnectBotState, formData: FormData): Promise<ConnectBotState> {
  const { workspace, user, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: "Bot ulash uchun tahrirlash huquqi kerak." };

  const token = String(formData.get("token") ?? "").trim();
  const invalid = validateBotToken(token);
  if (invalid) return { status: "error", message: invalid, token };

  let botId: string;
  try {
    const bot = await botsRepository.create({
      workspaceId: workspace.id,
      projectId: await resolveProjectId(workspace.id, String(formData.get("projectId") ?? ""), user.email),
      kind: "bot",
      token,
    });
    botId = bot.id;
  } catch (error) {
    // Every failure is reported, not just the ones the backend named. A crash
    // here used to reach the reader as a page that simply came back with
    // nothing connected and nothing said.
    const message =
      error instanceof ApiError
        ? error.message
        : "Botni ulab bo'lmadi — server javob bermadi. Birozdan so'ng qayta urinib ko'ring.";
    if (!(error instanceof ApiError)) console.error("connectBotAction failed", error);
    return { status: "error", message, token };
  }

  revalidatePath("/bots");
  redirect(`/bots/${botId}`);
}

/**
 * Opens a "create it on Telegram" attempt and hands back the link.
 *
 * The link is the whole result: nothing is created here, and nothing can be —
 * the bot is born on a confirmation screen only the reader can press, and it
 * reaches this deployment through the manager bot's webhook. See
 * `apps/bots/managed.py` for why that leaves a request row behind.
 */
export async function openBotCreateRequestAction(
  input: { projectId: string; name: string; username: string },
): Promise<{ status: "opened"; request: BotCreateRequest } | { status: "error"; message: string }> {
  const { workspace, user, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: "Bot yaratish uchun tahrirlash huquqi kerak." };

  try {
    const request = await botsRepository.openCreateRequest({
      workspaceId: workspace.id,
      projectId: await resolveProjectId(workspace.id, input.projectId, user.email),
      name: input.name.trim(),
      username: input.username.trim().replace(/^@/, ""),
    });
    return { status: "opened", request };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "So'rovni ochib bo'lmadi — server javob bermadi. Birozdan so'ng qayta urinib ko'ring.";
    if (!(error instanceof ApiError)) console.error("openBotCreateRequestAction failed", error);
    return { status: "error", message };
  }
}

/** Polled by the screen while the reader is away in Telegram. */
export async function botCreateStatusAction(requestId: string): Promise<BotCreateStatus> {
  const { workspace } = await getSession();
  try {
    const status = await botsRepository.createRequestStatus(workspace.id, requestId);
    // The bot only exists once Telegram has answered, so the list it belongs
    // to is stale exactly here and nowhere earlier.
    if (status.status === "ready") revalidatePath("/bots");
    return status;
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("botCreateStatusAction failed", error);
    return { status: "failed", message: error instanceof ApiError ? error.message : "Holatni o'qib bo'lmadi." };
  }
}

export async function disconnectBotAction(formData: FormData): Promise<void> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return;

  const botId = String(formData.get("botId") ?? "");
  if (!botId) return;
  await botsRepository.delete(workspace.id, botId);
  revalidatePath("/bots");
  redirect("/bots");
}


/**
 * Asks Telegram where it is really posting, and says so.
 *
 * The panel does not trust its own stored answer for this: the failure worth
 * catching is precisely the one where our record says "connected" and
 * Telegram's does not.
 */
export async function checkBotWebhookAction(botId: string): Promise<WebhookCheck | null> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return null;
  const result = await botsRepository.checkWebhook(workspace.id, botId);
  revalidatePath(`/bots/${botId}`);
  return result;
}

/** Points Telegram back at this backend for one bot. */
export async function reconnectBotWebhookAction(botId: string): Promise<WebhookCheck | null> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return null;
  await botsRepository.registerWebhook(workspace.id, botId);
  const result = await botsRepository.checkWebhook(workspace.id, botId);
  revalidatePath(`/bots/${botId}`);
  return result;
}

/**
 * The same, for every bot in the workspace — the one button for "the address
 * moved". Reports how many actually needed changing, because "0 ta o'zgardi"
 * is the answer that says the problem was somewhere else.
 */
export async function reconcileWebhooksAction(): Promise<{ checked: number; changed: number } | null> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) return null;
  const result = await botsRepository.reconcileWebhooks(workspace.id);
  revalidatePath("/bots");
  return result;
}

/**
 * Saves the one source file every Kod block in this bot runs behind.
 *
 * The text is written through untouched — no trim, no normalising. It is a
 * file, not a field, and a save that quietly edits somebody's code is a save
 * they cannot trust.
 */
export async function saveBotScriptLibraryAction(
  _prev: ScriptLibraryState,
  formData: FormData,
): Promise<ScriptLibraryState> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { status: "error", message: "Kodni o'zgartirish uchun huquq yo'q." };

  const botId = String(formData.get("botId") ?? "");
  if (!botId) return { status: "error", message: "Bot topilmadi." };

  try {
    await scriptsRepository.saveLibrary(workspace.id, botId, String(formData.get("source") ?? ""));
  } catch (error) {
    // Named, not swallowed: this file is shared by every flow in the bot, so a
    // refusal the editor keeps to itself is a room full of blocks still running
    // the previous version while the author believes otherwise.
    const message = error instanceof ApiError ? error.message : "Kutubxona saqlanmadi — server javob bermadi.";
    if (!(error instanceof ApiError)) console.error("saveBotScriptLibraryAction failed", error);
    return { status: "error", message };
  }

  revalidatePath(`/bots/${botId}/code`);
  return { status: "saved", message: "Kutubxona saqlandi", savedAt: Date.now() };
}


// ---------------------------------------------------------------------------
// Groups and channels
// ---------------------------------------------------------------------------
//
// Three writes, all of them behind a button. Nothing here runs during a render:
// the list is a plain GET the page reads, and a refresh that fired on every
// render would spend three Bot API calls per chat every time somebody hovered
// the tab.

/**
 * Asks Telegram about one chat again, now.
 *
 * The webhook keeps the bot's *standing* current by itself; a group being
 * renamed, made public or joined by two hundred people announces nothing. A
 * refusal is not a failure of this action — the row keeps what it had and comes
 * back carrying a `stale` finding, which is the honest answer and the one the
 * screen prints.
 */
export async function refreshBotChatAction(botId: string, chatId: number): Promise<BotChat | null> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return null;
  try {
    const chat = await botsRepository.refreshChat(workspace.id, botId, chatId);
    revalidatePath(`/bots/${botId}/settings`);
    return chat;
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("refreshBotChatAction failed", error);
    return null;
  }
}

/**
 * Forgets one chat.
 *
 * Only ever a tidy-up. No Bot API method removes a bot from a group, so this
 * deletes a row and nothing else — and if the bot is still in that chat, the
 * next `my_chat_member` puts the row straight back. The screen says so, because
 * a reader who believed this had removed the bot would stop looking.
 */
export async function removeBotChatAction(botId: string, chatId: number): Promise<{ ok: boolean; message: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Buning uchun tahrirlash huquqi kerak." };
  try {
    await botsRepository.removeChat(workspace.id, botId, chatId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Ro'yxatdan o'chirib bo'lmadi.";
    if (!(error instanceof ApiError)) console.error("removeBotChatAction failed", error);
    return { ok: false, message };
  }
  revalidatePath(`/bots/${botId}/settings`);
  return { ok: true, message: "" };
}

/**
 * Switches one of the bot's surfaces on or off.
 *
 * It lives beside the chat list because that is where the consequence is
 * visible: `matching.find_trigger` refuses a module that is off *before* it
 * looks for a flow, so a whole groups flow can be drawn, switched on and
 * ignored, with nothing anywhere saying why. The chat row says why, and this is
 * the button under it. Both moved into Sozlamalar together, so they are still
 * next to each other — that adjacency was the point, not the tab.
 *
 * The list is sent whole rather than as a delta: `enabledModules` is one
 * column, and two people toggling two modules at once would otherwise each
 * write their own half over the other's.
 */
/**
 * Moves a bot into another project, flows and all.
 *
 * `projectId` has been writable on the endpoint from the start and reachable
 * from no screen at all — so a bot connected into the wrong project stayed
 * there unless somebody made an API call. The backend takes the flows with it
 * (`BotViewSet.perform_update`); `Flow` carries a project of its own beside its
 * bot, and a move that left them behind is a project listing flows for a bot it
 * no longer owns.
 */
export async function moveBotToProjectAction(
  botId: string,
  projectId: string,
): Promise<{ ok: boolean; message: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Buning uchun tahrirlash huquqi kerak." };

  try {
    await botsRepository.update(workspace.id, botId, { projectId });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Loyihani o'zgartirib bo'lmadi.";
    if (!(error instanceof ApiError)) console.error("moveBotToProjectAction failed", error);
    return { ok: false, message };
  }
  // The bot left one project's list and joined another's, and its own header
  // prints the project as a breadcrumb.
  revalidatePath("/bots");
  revalidatePath(`/bots/${botId}`);
  revalidatePath(`/bots/${botId}/settings`);
  revalidatePath("/projects");
  return { ok: true, message: "" };
}

/**
 * Stops the bot, or starts it again.
 *
 * The button this replaces lived in the bot header's overflow menu, asked
 * «Bot to'xtatiladi va xabarlarga javob bermaydi» behind a destructive
 * confirmation, and then fired a toast. No request left the browser: the bot
 * went on answering customers all the while the panel said it had been
 * stopped. This one writes a column the runtime reads —
 * `Bot.module_enabled`, which is what `matching.find_trigger` asks before it
 * looks for a flow at all.
 *
 * `canManageWorkspace` and not `canEditContent`: switching the whole bot off
 * is not editing content, it is the same class of act as disconnecting it.
 */
export async function setBotPausedAction(
  botId: string,
  paused: boolean,
): Promise<{ ok: boolean; message: string }> {
  const { workspace, role } = await getSession();
  if (!canManageWorkspace(role)) {
    return { ok: false, message: "Botni to'xtatishni faqat egasi va adminlar qila oladi." };
  }

  try {
    await botsRepository.update(workspace.id, botId, { isPaused: paused });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Holatni o'zgartirib bo'lmadi.";
    if (!(error instanceof ApiError)) console.error("setBotPausedAction failed", error);
    return { ok: false, message };
  }
  // Every screen that prints the bot's status reads the same field, so all
  // three are stale at once: the list, the bot's own header and this screen.
  revalidatePath("/bots");
  revalidatePath(`/bots/${botId}`);
  revalidatePath(`/bots/${botId}/settings`);
  return { ok: true, message: "" };
}

export async function setBotModuleAction(
  botId: string,
  moduleKey: ModuleKey,
  enabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  const { workspace, role } = await getSession();
  if (!canEditContent(role)) return { ok: false, message: "Buning uchun tahrirlash huquqi kerak." };

  const bot = await botsRepository.getById(workspace.id, botId);
  if (!bot) return { ok: false, message: "Bot topilmadi." };

  // An empty stored list means "nobody has configured this", which the runtime
  // reads as dms-only — so the first module ever switched on has to write dms
  // down as well, or turning Guruh on would turn the bot's own chat off.
  const current = new Set<ModuleKey>(bot.enabledModules.length ? bot.enabledModules : ["dms"]);
  if (enabled) current.add(moduleKey);
  else current.delete(moduleKey);

  // An empty list is not "everything off" — `Bot.module_enabled` reads it as
  // "nobody has configured this" and answers `dms` anyway. So unchecking the
  // last row would leave every switch off on screen and the bot still replying
  // in its own chat, which is the panel telling the author something the
  // runtime does not do. Refused, with the reason, rather than silently
  // rewritten to `["dms"]`: they asked for something this cannot mean.
  if (current.size === 0) {
    return { ok: false, message: "Kamida bitta bo'lim yoqilgan bo'lishi kerak." };
  }

  try {
    await botsRepository.update(workspace.id, botId, { enabledModules: [...current] });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Bo'limni o'zgartirib bo'lmadi.";
    if (!(error instanceof ApiError)) console.error("setBotModuleAction failed", error);
    return { ok: false, message };
  }
  revalidatePath(`/bots/${botId}/settings`);
  revalidatePath(`/bots/${botId}`);
  return { ok: true, message: "" };
}
