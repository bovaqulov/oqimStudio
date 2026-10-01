import "server-only";
import { apiList, apiRequest } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import type { ApiKey, ApiKeyScope, CreatedApiKey } from "../types";

/**
 * The workspace's API keys — the credentials that are not a person.
 *
 * Backed by `/api/api-keys/`. Three calls and no fourth: there is no read of a
 * single key, because a key has nothing to show that the list does not, and no
 * update, because the only change a key ever undergoes is being revoked.
 *
 * Who is asking never travels as an argument. The request carries the session
 * token and the workspace header, and the backend answers for whoever that is.
 */

/** One row, exactly as the backend serialises it. */
interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * The create response: the same row plus the credential itself.
 *
 * `key` appears here and in no other shape in this file, which is the whole
 * fact about it — the backend stores a hash, so this field exists in exactly
 * one HTTP response ever and cannot be asked for again.
 */
interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

/*
 * Timestamps become sentences here, where the data arrives, rather than in the
 * components — the house rule in `lib/utils/date`. Two different phrasings on
 * purpose: `createdAt` is a fact about the past and reads as a date, while
 * `lastUsedAt` is being read to answer "is anything still using this", and
 * "3 oy oldin" answers that where "12 mart 2026" makes the reader do the
 * subtraction.
 */
function toApiKey(dto: ApiKeyDto): ApiKey {
  return {
    id: dto.id,
    name: dto.name,
    prefix: dto.prefix,
    scopes: dto.scopes ?? [],
    createdBy: dto.createdBy,
    createdAt: formatInstant(dto.createdAt),
    lastUsedAt: dto.lastUsedAt ? formatRelative(dto.lastUsedAt) : null,
    revokedAt: dto.revokedAt ? formatInstant(dto.revokedAt) : null,
  };
}

export interface CreateApiKeyInput {
  workspaceId: string;
  name: string;
  scopes: ApiKeyScope[];
}

export interface ApiKeysRepository {
  /** Every key the workspace has ever minted, revoked ones included. */
  list(workspaceId: string): Promise<ApiKey[]>;
  /**
   * Mints one and hands back the credential — the only time it is readable.
   * The caller owns it from here; nothing in this app stores it.
   */
  create(input: CreateApiKeyInput): Promise<CreatedApiKey>;
  /** Stops the key working. There is no undo, and the row stays in the list. */
  revoke(workspaceId: string, keyId: string): Promise<void>;
}

class ApiApiKeysRepository implements ApiKeysRepository {
  async list(workspaceId: string): Promise<ApiKey[]> {
    const rows = await apiList<ApiKeyDto>("/api/api-keys/", { workspaceId });
    return rows.map(toApiKey);
  }

  async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const dto = await apiRequest<CreatedApiKeyDto>("/api/api-keys/", {
      method: "POST",
      workspaceId: input.workspaceId,
      body: { name: input.name, scopes: input.scopes },
    });
    return { secret: dto.key, name: dto.name, prefix: dto.prefix, scopes: dto.scopes ?? [] };
  }

  async revoke(workspaceId: string, keyId: string): Promise<void> {
    await apiRequest(`/api/api-keys/${encodeURIComponent(keyId)}/`, { method: "DELETE", workspaceId });
  }
}

export const apiKeysRepository: ApiKeysRepository = new ApiApiKeysRepository();
