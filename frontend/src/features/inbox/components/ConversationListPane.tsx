import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatRelative } from "@/lib/utils/date";
import { messageLabel } from "../format";
import type { ConversationSummary } from "../types";

/**
 * The left half of the chats screen: search, then every conversation.
 *
 * One component for both routes because on a desktop it *is* both routes — the
 * list stays on screen while a thread is open beside it, the way Telegram's
 * own client sits, and the open one is marked. The search form is a GET whose
 * action pins it to /chats, so searching from inside a thread lands on the
 * list it filters rather than on the thread's own URL.
 */
export function ConversationListPane({
  conversations,
  query,
  projects = [],
  bots = [],
  projectId = "",
  botId = "",
  activeContactId,
}: {
  conversations: ConversationSummary[];
  query: string;
  /** Only offered when there is more than one — a picker with one option decides nothing. */
  projects?: { id: string; name: string }[];
  bots?: { id: string; handle: string }[];
  projectId?: string;
  botId?: string;
  activeContactId?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/*
        One GET form for the search and both cuts, so a filtered list stays a
        URL somebody can send. The screen had text search and nothing else:
        every bot in the workspace poured into one list, which for an account
        running two businesses meant a clinic's patients and a school's
        students interleaved by timestamp with no way to separate them.

        The selects submit themselves — a "filter" button beside a list that
        could simply have filtered is a step that exists to be forgotten. The
        search keeps its Enter.
      */}
      <form method="GET" action="/chats" className="flex flex-none flex-col gap-2">
        <Input name="q" defaultValue={query} placeholder="Ism, username yoki xabar matni…" aria-label="Qidirish" />
        {(projects.length > 1 || bots.length > 1) && (
          <div className="flex gap-2">
            {projects.length > 1 && (
              <Select
                name="projectId"
                defaultValue={projectId}
                aria-label="Loyiha"
                className="h-9 min-w-0 flex-1 text-[13px]"
              >
                <option value="">Barcha loyihalar</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            )}
            {bots.length > 1 && (
              <Select name="botId" defaultValue={botId} aria-label="Bot" className="h-9 min-w-0 flex-1 text-[13px]">
                <option value="">Barcha botlar</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.handle}
                  </option>
                ))}
              </Select>
            )}
            <button
              type="submit"
              className="oq-press t-footnote h-9 flex-none cursor-pointer rounded-[12px] bg-neutral-800 px-3 text-neutral-300"
            >
              Filtr
            </button>
          </div>
        )}
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-[16px] border border-separator bg-surface">
        {conversations.length === 0 ? (
          <EmptyState
            icon="chats-circle"
            title={query ? "Hech nima topilmadi" : "Hali suhbat yo'q"}
            description={
              query ? "Boshqa so'z bilan qidirib ko'ring." : "Botga kimdir yozganda suhbat shu yerda paydo bo'ladi."
            }
          />
        ) : (
          <div className="flex flex-col">
            {conversations.map((conversation, index) => {
              const active = conversation.contactId === activeContactId;
              return (
                <Link
                  key={conversation.contactId}
                  href={`/chats/${conversation.contactId}`}
                  aria-current={active ? "page" : undefined}
                  className={`oq-press flex items-center gap-3 px-3.5 py-3 ${
                    index > 0 ? "border-t border-separator" : ""
                  } ${active ? "bg-accent-900/40" : ""}`}
                >
                  <Avatar name={conversation.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="t-subhead min-w-0 flex-none truncate">{conversation.name}</span>
                      {/* Which bot they wrote to. The same person on two of a
                          workspace's bots is two conversations — without the
                          handle those are two identical rows. */}
                      <span className="t-caption t-tertiary min-w-0 flex-1 truncate">{conversation.botHandle}</span>
                      {conversation.lastMessage && (
                        <span className="t-caption t-tertiary flex-none">
                          {formatRelative(conversation.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>
                    <div className="t-footnote t-tertiary flex items-center gap-1.5">
                      {/* Whose line it was. Without it a thread whose last
                          word is the bot's reads as the customer's. */}
                      {conversation.lastMessage?.direction === "out" && <span className="t-tertiary">Siz:</span>}
                      <span className="min-w-0 flex-1 truncate">
                        {conversation.lastMessage ? messageLabel(conversation.lastMessage) : "—"}
                      </span>
                    </div>
                  </div>
                  {conversation.isBlocked && <Badge tone="danger">Bloklangan</Badge>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
