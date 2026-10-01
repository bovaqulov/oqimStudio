import "server-only";
import { apiRequest } from "@/lib/api/server";
import { formatRelative } from "@/lib/utils/date";
import type { BotScriptBlock, BotScriptLibrary, BotScripts } from "../types";

/**
 * A bot's code, gathered out of its flows.
 *
 * The blocks come from the backend already flattened rather than from the flow
 * records: listing them here would mean pulling every graph in the bot into the
 * page to find the handful of nodes with a `script` on them, and the count and
 * the flow's name are things the server already knows.
 */
export interface ScriptsRepository {
  overview(workspaceId: string, botId: string): Promise<BotScripts>;
  /** Write roles only — the backend refuses the rest, and the action checks first. */
  saveLibrary(workspaceId: string, botId: string, source: string): Promise<BotScriptLibrary>;
}

/** `updatedAt` is null for a library nobody has saved yet. */
interface LibraryDto {
  source: string;
  updatedAt: string | null;
}

interface ScriptsDto {
  library: LibraryDto;
  blocks: BotScriptBlock[];
}

function toLibrary(dto: LibraryDto): BotScriptLibrary {
  return { source: dto.source, updatedAt: formatRelative(dto.updatedAt) };
}

class ApiScriptsRepository implements ScriptsRepository {
  async overview(workspaceId: string, botId: string): Promise<BotScripts> {
    const dto = await apiRequest<ScriptsDto>(`/api/bots/${botId}/scripts/`, { workspaceId });
    return { library: toLibrary(dto.library), blocks: dto.blocks };
  }

  async saveLibrary(workspaceId: string, botId: string, source: string): Promise<BotScriptLibrary> {
    const dto = await apiRequest<LibraryDto>(`/api/bots/${botId}/script-library/`, {
      // PUT and not PATCH: the whole file is what was edited, and a partial
      // write of a source file is not a thing that exists.
      method: "PUT",
      workspaceId,
      body: { source },
    });
    return toLibrary(dto);
  }
}

export const scriptsRepository: ScriptsRepository = new ApiScriptsRepository();
