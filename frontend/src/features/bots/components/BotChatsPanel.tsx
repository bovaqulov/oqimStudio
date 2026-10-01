import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { botsRepository } from "../data/bots-repository";
import type { Bot, BotChat } from "../types";
import { BotChatRow } from "./BotChatRow";

/**
 * «Guruh va kanal boshqaruvi» — which rooms the bot is in, and what is wrong
 * where something is.
 *
 * Rendered at the top of Sozlamalar. It had a section of its own («Guruhlar»)
 * beside Bot, To'lovlar and Kod; that segment is gone and `/bots/<id>/chats`
 * redirects here, so a bookmark still lands on the rooms rather than on a 404.
 *
 * Written to answer one question, because it is the only question anybody opens
 * it with: *botim nega bu guruhda ishlamayapti*. So the order is the order of
 * the causes: the chats that are broken, then the ones that are fine, then the
 * ones the bot was thrown out of.
 *
 * The module switches used to be rendered from inside here, on the argument
 * that a surface switched off is the one fault no amount of Telegram rights can
 * fix. They still sit directly above this panel — Sozlamalar renders them there
 * — and they are their own component now because a second surface needs them in
 * exactly the same way: `BotBusinessPanel` reports the very same `module_off`
 * about an attached Business account, and a switch list owned by the group
 * panel could only ever be above one of the two.
 *
 * The list arrives filled. Nothing on this screen puts a chat on it: the
 * `my_chat_member` webhook does (`apps/engine/dispatch` → `apps/bots/chats`), so
 * adding the bot to a group in Telegram is the whole of the setup and the row
 * appears without anybody pressing anything here. That is also why an empty
 * list says what to do in Telegram rather than offering a button.
 */
export async function BotChatsPanel({ bot, canManage }: { bot: Bot; canManage: boolean }) {
  const chats = await botsRepository.listChats(bot.workspaceId, bot.id);

  // Three piles, and the order is the reader's: what needs doing, what is
  // running, and what is history. The backend already sorts the departed to
  // the bottom; this splits the live ones by whether they have a finding.
  const broken = chats.filter((chat) => chat.isMember && chat.problems.length > 0);
  const healthy = chats.filter((chat) => chat.isMember && chat.problems.length === 0);
  const gone = chats.filter((chat) => !chat.isMember);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="t-headline m-0 flex-1">Guruh va kanallar</h2>
        {chats.length > 0 && <span className="t-footnote t-tertiary tabular-nums">{chats.length}</span>}
      </div>

      {chats.length === 0 ? (
        <EmptyState
          icon="users-three"
          title="Bot hali hech qanday guruh yoki kanalda emas"
          description="Telegramda guruhni oching → A'zo qo'shish → botni tanlang. Ro'yxat o'zi to'ladi."
        />
      ) : (
        <>
          <Section
            title="E'tibor talab qiladi"
            count={broken.length}
            chats={broken}
            botId={bot.id}
            canManage={canManage}
          />
          <Section title="Ishlayapti" count={healthy.length} chats={healthy} botId={bot.id} canManage={canManage} />
          <Section
            title="Endi a'zo emas"
            count={gone.length}
            chats={gone}
            botId={bot.id}
            canManage={canManage}
            footer="Bot bu chatlardan chiqarilgan. Qayta qo'shsangiz qator o'zi tiklanadi."
          />
        </>
      )}

      <p className="t-footnote t-tertiary m-0 flex items-start gap-1.5 px-1">
        <Icon name="info" size={13} className="mt-[3px] flex-none" />
        <span>
          Ro&apos;yxat Telegram xabarnomalari orqali o&apos;zi yangilanadi. A&apos;zolar soni va nom esa
          so&apos;ralganda o&apos;qiladi — chatni ochib «Telegramdan yangilash» tugmasini bosing.
        </span>
      </p>
    </div>
  );
}

function Section({
  title,
  count,
  chats,
  botId,
  canManage,
  footer,
}: {
  title: string;
  count: number;
  chats: BotChat[];
  botId: string;
  canManage: boolean;
  footer?: string;
}) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="t-subhead t-secondary m-0 flex-1">{title}</h3>
        <span className="t-footnote t-tertiary tabular-nums">{count}</span>
      </div>
      {chats.map((chat) => (
        <BotChatRow key={chat.id} chat={chat} botId={botId} canManage={canManage} />
      ))}
      {footer && <p className="t-footnote t-tertiary m-0 px-1">{footer}</p>}
    </section>
  );
}
