import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ListGroup, ListLink } from "@/components/ui/List";
import type { ChannelStatus } from "../data";

/**
 * Which bots are live, at a glance.
 *
 * One grouped list: the bot's icon in the tinted square its status colours, the
 * handle as the row, the status as the badge at the end. The heading matches
 * "Oqimlar" beside it (`t-headline`) rather than the 12.5px it used to be, so
 * the two columns of the dashboard read as the same rank.
 *
 * A workspace with no bot gets nothing here rather than an empty card: the
 * onboarding checklist on the same page already opens with "Botni ulash" and a
 * link, so the card would repeat the instruction in a weaker voice.
 */
export function ChannelStatusList({ channels }: { channels: ChannelStatus[] }) {
  if (channels.length === 0) return null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-1">
        <h2 className="t-headline m-0 min-w-0 flex-1 truncate">Kanallar holati</h2>
        <Link href="/bots" className="t-subhead flex min-h-[44px] flex-none items-center px-1 text-accent-400">
          Barchasi
        </Link>
      </div>
      <ListGroup inset="icon" className="pt-1">
        {channels.map((channel) => (
          <ListLink
            key={channel.href}
            href={channel.href}
            icon={channel.icon}
            iconTone={channel.status.tone}
            label={channel.name}
            trailing={<Badge tone={channel.status.tone}>{channel.status.label}</Badge>}
          />
        ))}
      </ListGroup>
    </div>
  );
}
