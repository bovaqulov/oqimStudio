import "server-only";
import { apiFind, apiList, apiRequest } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import { normalizeLanguages } from "../languages";
import type { ModuleKey } from "@/features/flows";
import type {
  Bot,
  BotActivityEntry,
  BotChat,
  BotCreateRequest,
  BusinessConnection,
  BotCreateStatus,
  ManagedBotConfig,
  BotKind,
  BotLanguages,
  BotSettings,
  WebhookCheck,
  WebhookProbe,
} from "../types";

export interface CreateBotInput {
  workspaceId: string;
  projectId: string;
  kind: BotKind;
  /** Bot API token for a bot, phone number for a userbot. */
  token: string;
}

/** Tenant-scoped like every other repository — the workspace id is never optional. */
export interface BotsRepository {
  list(workspaceId: string): Promise<Bot[]>;
  listByProject(workspaceId: string, projectId: string): Promise<Bot[]>;
  getById(workspaceId: string, id: string): Promise<Bot | undefined>;
  /**
   * Connects a bot: the backend asks Telegram who the token belongs to,
   * registers the webhook and stores the result. A token Telegram refuses
   * never becomes a row.
   */
  create(input: CreateBotInput): Promise<Bot>;
  update(workspaceId: string, id: string, patch: Partial<Omit<Bot, "id" | "workspaceId">>): Promise<Bot | undefined>;
  /** The real token, fetched through the endpoint that says so in its name. */
  revealToken(workspaceId: string, id: string): Promise<string | undefined>;
  /** Telegram's own view of the webhook, read back with `getWebhookInfo`. */
  checkWebhook(workspaceId: string, id: string): Promise<WebhookCheck>;

  // -- the groups and channels the bot is in -------------------------------
  //
  // The list is filled by the `my_chat_member` webhook, not by this client:
  // adding the bot to a group is done in Telegram and shows up here on its own.
  // `refreshChat` is the "ask Telegram again" button and `removeChat` only
  // forgets a row — no Bot API method lets a bot leave a chat.

  listChats(workspaceId: string, botId: string): Promise<BotChat[]>;
  refreshChat(workspaceId: string, botId: string, chatId: number): Promise<BotChat>;
  removeChat(workspaceId: string, botId: string, chatId: number): Promise<void>;
  registerWebhook(workspaceId: string, id: string): Promise<void>;
  reconcileWebhooks(workspaceId: string): Promise<{ checked: number; changed: number }>;
  delete(workspaceId: string, id: string): Promise<void>;

  // -- creating a bot rather than pasting one ------------------------------
  //
  // Three calls because the bot is born on Telegram's side: the panel opens a
  // request, the reader confirms a screen Telegram draws, and the manager bot
  // is handed the result out of band. See `apps/bots/managed.py`.

  /**
   * The Business accounts that have attached this bot, as Telegram reports
   * them. Empty is the normal state — most bots are never attached to one.
   */
  listBusinessConnections(workspaceId: string, botId: string): Promise<BusinessConnection[]>;

  /** Whether "Botni yaratish" can be offered here at all. */
  managedConfig(workspaceId: string): Promise<ManagedBotConfig>;
  /** Opens an attempt and names the `t.me` link that completes it. */
  openCreateRequest(input: CreateBotRequestInput): Promise<BotCreateRequest>;
  /** Whether the bot has arrived yet. */
  createRequestStatus(workspaceId: string, id: string): Promise<BotCreateStatus>;
}

export interface CreateBotRequestInput {
  workspaceId: string;
  projectId: string;
  /** Suggested display name. Telegram pre-fills it and lets the reader edit it. */
  name: string;
  /** Suggested `@username`, without the `@`. Same: a suggestion, not a setting. */
  username: string;
}

type BusinessConnectionDto = Omit<BusinessConnection, "connectedAt"> & { connectedAt: string };

/**
 * A chat as the API sends it: four ISO instants where `BotChat` carries the
 * ages a reader actually asks for.
 *
 * "When was this count read" is the question a member count raises, and the
 * answer to it is «2 soat oldin», not a date. `addedAt` is the exception and
 * stays a date — that one is a fact about the past rather than a freshness
 * claim.
 */
type BotChatDto = Omit<BotChat, "memberCountAt" | "addedAt" | "leftAt" | "refreshedAt"> & {
  memberCountAt: string | null;
  addedAt: string | null;
  leftAt: string | null;
  refreshedAt: string | null;
};

function toChat(dto: BotChatDto): BotChat {
  return {
    ...dto,
    memberCountAt: formatRelative(dto.memberCountAt),
    addedAt: formatInstant(dto.addedAt),
    leftAt: formatRelative(dto.leftAt),
    refreshedAt: formatRelative(dto.refreshedAt),
  };
}

/** The fields of Telegram's `getWebhookInfo` this product reads. */
interface TelegramWebhookInfo {
  url?: string;
  last_error_message?: string;
  last_error_date?: number;
  pending_update_count?: number;
}

/** What `GET /api/bots/<id>/webhook/` sends — see `apps/bots/services.py::webhook_snapshot`. */
interface WebhookCheckDto {
  ok?: boolean;
  url?: string;
  actualUrl?: string;
  error?: string;
  lastErrorAt?: string | null;
  pending?: number;
  checkedAt?: string | null;
  probe?: WebhookProbe;
  info?: TelegramWebhookInfo;
}

/** A probe field is absent until the backend that added it is deployed. */
const UNPROBED: WebhookProbe = { checked: false, reachable: false, status: null, error: "" };

/** What the API sends. No `token`: it leaves the server through `revealToken` and nowhere else. */
interface BotDto {
  id: string;
  workspaceId: string;
  projectId: string;
  handle: string;
  kind: BotKind;
  status: Bot["status"];
  /** Absent against a backend older than the switch — an unstopped bot either way. */
  isPaused?: boolean;
  updatedAt: string;
  tokenMasked: string;
  /** `languages` is optional: bots connected before that setting existed have none stored. */
  settings: Omit<BotSettings, "languages"> & { languages?: Partial<BotLanguages> };
  enabledModules?: string[];
  webhookUrl?: string;
  webhookError?: string;
  webhookActualUrl?: string;
  webhookRegistered?: boolean;
  webhookLastErrorAt?: string | null;
  webhookPending?: number;
  webhookCheckedAt?: string | null;
  connectedAt?: string;
  connectedBy?: string;
  activity?: { id: string; text: string; icon: string; when: string }[];
}

function toBot(dto: BotDto): Bot {
  return {
    id: dto.id,
    workspaceId: dto.workspaceId,
    projectId: dto.projectId,
    // Empty rather than defaulted to `["dms"]`: the backend reads an empty list
    // as "nobody has configured this yet, answer dms anyway", and writing the
    // default in here would turn the first save of any other module into one
    // that silently switched dms on as well.
    enabledModules: (dto.enabledModules ?? []) as ModuleKey[],
    handle: dto.handle,
    kind: dto.kind,
    status: dto.status,
    isPaused: dto.isPaused ?? false,
    updatedAt: `${formatRelative(dto.updatedAt)} yangilangan`,
    tokenMasked: dto.tokenMasked,
    // The one secret this product holds is not in any list or detail response;
    // `revealToken` is the only way to it, and it is audited.
    token: "",
    settings: {
      ...dto.settings,
      languages: normalizeLanguages(dto.settings?.languages),
    },
    webhookUrl: dto.webhookUrl ?? "",
    webhook: {
      url: dto.webhookUrl ?? "",
      actualUrl: dto.webhookActualUrl ?? "",
      registered: dto.webhookRegistered ?? false,
      error: dto.webhookError ?? "",
      lastErrorAt: formatInstant(dto.webhookLastErrorAt),
      lastErrorAgo: formatRelative(dto.webhookLastErrorAt),
      pending: dto.webhookPending ?? 0,
      checkedAt: formatRelative(dto.webhookCheckedAt),
    },
    connectedAt: formatInstant(dto.connectedAt),
    connectedBy: dto.connectedBy ?? "",
    activity: (dto.activity ?? []).map(
      (entry): BotActivityEntry => ({
        text: entry.text,
        icon: entry.icon as BotActivityEntry["icon"],
        when: formatRelative(entry.when),
      }),
    ),
  };
}

/** The mask the settings screen shows while the real token stays on the server. */
export function maskToken(token: string): string {
  const [head, tail] = token.split(":");
  if (!tail) return `${"*".repeat(6)}${token.slice(-4)}`;
  return `${head}:${"*".repeat(6)}${tail.slice(-4)}`;
}

class ApiBotsRepository implements BotsRepository {
  async list(workspaceId: string): Promise<Bot[]> {
    const rows = await apiList<BotDto>("/api/bots/", { workspaceId });
    return rows.map(toBot);
  }

  async listByProject(workspaceId: string, projectId: string): Promise<Bot[]> {
    const rows = await apiList<BotDto>("/api/bots/", { workspaceId, params: { projectId } });
    return rows.map(toBot);
  }

  async getById(workspaceId: string, id: string): Promise<Bot | undefined> {
    const dto = await apiFind<BotDto>(`/api/bots/${id}/`, { workspaceId });
    return dto && toBot(dto);
  }

  async create(input: CreateBotInput): Promise<Bot> {
    const dto = await apiRequest<BotDto>("/api/bots/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: { projectId: input.projectId, token: input.token, kind: input.kind },
    });
    return toBot(dto);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<Omit<Bot, "id" | "workspaceId">>,
  ): Promise<Bot | undefined> {
    // Only what the API accepts: the rest of `Bot` is derived (metrics,
    // activity, the webhook) and is not something a form may write back.
    const body: Record<string, unknown> = {};
    if (patch.settings) body.settings = patch.settings;
    if (patch.projectId) body.projectId = patch.projectId;
    if (patch.enabledModules) body.enabledModules = patch.enabledModules;
    // `!== undefined`, because `false` is the half of this switch that turns
    // the bot back on and a truthiness test would drop it.
    if (patch.isPaused !== undefined) body.isPaused = patch.isPaused;

    const dto = await apiFind<BotDto>(`/api/bots/${id}/`, { method: "PATCH", workspaceId, body });
    return dto && toBot(dto);
  }

  async checkWebhook(workspaceId: string, id: string): Promise<WebhookCheck> {
    const payload = await apiRequest<WebhookCheckDto>(`/api/bots/${id}/webhook/`, { workspaceId });
    // Telegram's raw `info` still stands in field by field: the endpoint that
    // names each fact separately is newer than this client, and a panel that
    // renders blanks against an older backend is a worse answer than a partial
    // one.
    const info = payload.info ?? {};
    return {
      registered: Boolean(payload.ok),
      actualUrl: payload.actualUrl || (info.url ?? ""),
      expectedUrl: payload.url ?? "",
      error: payload.error || (info.last_error_message ?? ""),
      lastErrorAt: formatInstant(payload.lastErrorAt),
      lastErrorAgo: formatRelative(payload.lastErrorAt),
      pending: payload.pending ?? info.pending_update_count ?? 0,
      checkedAt: formatRelative(payload.checkedAt),
      probe: payload.probe ?? UNPROBED,
    };
  }

  async listChats(workspaceId: string, botId: string): Promise<BotChat[]> {
    const rows = await apiList<BotChatDto>(`/api/bots/${botId}/chats/`, { workspaceId });
    return rows.map(toChat);
  }

  async refreshChat(workspaceId: string, botId: string, chatId: number): Promise<BotChat> {
    const dto = await apiRequest<BotChatDto>(`/api/bots/${botId}/chats/${chatId}/refresh/`, {
      method: "POST",
      workspaceId,
      body: {},
    });
    return toChat(dto);
  }

  async removeChat(workspaceId: string, botId: string, chatId: number): Promise<void> {
    await apiRequest(`/api/bots/${botId}/chats/${chatId}/`, { method: "DELETE", workspaceId });
  }

  async registerWebhook(workspaceId: string, id: string): Promise<void> {
    await apiRequest(`/api/bots/${id}/webhook/`, { method: "POST", workspaceId, body: {} });
  }

  async reconcileWebhooks(workspaceId: string): Promise<{ checked: number; changed: number }> {
    return apiRequest("/api/bots/reconcile-webhooks/", { method: "POST", workspaceId, body: {} });
  }

  async revealToken(workspaceId: string, id: string): Promise<string | undefined> {
    const result = await apiFind<{ token: string }>(`/api/bots/${id}/reveal-token/`, {
      method: "POST",
      workspaceId,
      body: {},
    });
    return result?.token;
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    await apiRequest(`/api/bots/${id}/`, { method: "DELETE", workspaceId });
  }

  async listBusinessConnections(workspaceId: string, botId: string): Promise<BusinessConnection[]> {
    const rows = await apiList<BusinessConnectionDto>(`/api/bots/${botId}/business-connections/`, { workspaceId });
    return rows.map((dto) => ({ ...dto, connectedAt: formatInstant(dto.connectedAt) }));
  }

  async managedConfig(workspaceId: string): Promise<ManagedBotConfig> {
    return apiRequest<ManagedBotConfig>("/api/bots/managed-config/", { workspaceId });
  }

  async openCreateRequest(input: CreateBotRequestInput): Promise<BotCreateRequest> {
    return apiRequest<BotCreateRequest>("/api/bots/create-request/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: { projectId: input.projectId, name: input.name, username: input.username },
    });
  }

  async createRequestStatus(workspaceId: string, id: string): Promise<BotCreateStatus> {
    const dto = await apiRequest<BotCreateStatus & { bot?: BotDto }>(`/api/bots/create-request/${id}/`, {
      workspaceId,
    });
    return dto.bot ? { ...dto, bot: toBot(dto.bot) } : dto;
  }
}

export const botsRepository: BotsRepository = new ApiBotsRepository();
