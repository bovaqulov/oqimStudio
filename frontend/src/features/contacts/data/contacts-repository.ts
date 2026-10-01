import "server-only";
import { apiFind, apiList } from "@/lib/api/server";
import { formatInstant, formatRelative } from "@/lib/utils/date";
import type { Contact, ContactFilters, Conversation } from "../types";

/**
 * Contacts, from `/api/contacts/`.
 *
 * Read-only here on purpose: a contact is created by somebody writing to the
 * bot, never by this app.
 */
export interface ContactsRepository {
  list(workspaceId: string, filters?: ContactFilters): Promise<{ rows: Contact[]; total: number }>;
  getById(workspaceId: string, id: string): Promise<Contact | undefined>;
  /** Every conversation this person has had, oldest first. */
  getHistory(workspaceId: string, id: string): Promise<Conversation[]>;
  /**
   * The variable names the flows have written, for the column picker. Narrowed
   * by the same filters as the list, so the picker offers the names that are
   * actually in front of the reader.
   */
  listVariableKeys(workspaceId: string, filters?: ContactFilters): Promise<string[]>;
}

type ContactDto = Omit<Contact, "lastSeenAt" | "firstSeenAt"> & { lastSeenAt: string; firstSeenAt: string };

function toContact(dto: ContactDto): Contact {
  return {
    ...dto,
    firstSeenAt: formatInstant(dto.firstSeenAt),
    lastSeenAt: formatRelative(dto.lastSeenAt),
  };
}

function toParams(filters: ContactFilters = {}): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }
  return params;
}

class ApiContactsRepository implements ContactsRepository {
  async list(workspaceId: string, filters: ContactFilters = {}): Promise<{ rows: Contact[]; total: number }> {
    const rows = await apiList<ContactDto>("/api/contacts/", { workspaceId, params: toParams(filters) });
    return { rows: rows.map(toContact), total: rows.length };
  }

  async getById(workspaceId: string, id: string): Promise<Contact | undefined> {
    const dto = await apiFind<ContactDto>(`/api/contacts/${id}/`, { workspaceId });
    return dto && toContact(dto);
  }

  async getHistory(workspaceId: string, id: string): Promise<Conversation[]> {
    const rows = await apiList<Conversation>(`/api/contacts/${id}/history/`, { workspaceId });
    return rows;
  }

  async listVariableKeys(workspaceId: string, filters: ContactFilters = {}): Promise<string[]> {
    return apiList<string>("/api/contacts/variable-keys/", { workspaceId, params: toParams(filters) });
  }
}

export const contactsRepository: ContactsRepository = new ApiContactsRepository();
