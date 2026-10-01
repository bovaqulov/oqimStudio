import { clockAt, dayAt, messageLabel } from "../format";
import type { InboxMessage } from "../types";

/**
 * One conversation, read downwards.
 *
 * The customer on the left, the workspace on the right — the arrangement every
 * chat app has, so it needs no legend. What does need saying is *who* answered:
 * a line the runtime sent and a line a colleague typed look the same to the
 * customer and mean entirely different things to the next person reading the
 * thread, so an operator's name sits above their bubble.
 */
export function MessageThread({ messages, timeZone }: { messages: InboxMessage[]; timeZone: string }) {
  // The dividers are worked out before anything draws. Deciding "is this the
  // first line of a new day" from a variable the map reassigns is a render that
  // reads its own leftovers — right the first time and wrong on the next pass.
  const rows = messages.map((message, index) => {
    const day = dayAt(message.createdAt, timeZone);
    return { message, day, opensADay: day !== (index > 0 ? dayAt(messages[index - 1]!.createdAt, timeZone) : "") };
  });

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ message, day, opensADay }) => {
        const outgoing = message.direction === "out";

        return (
          <div key={message.id} className="flex flex-col gap-2">
            {opensADay && (
              <div className="t-footnote t-tertiary self-center rounded-full bg-neutral-900 px-2.5 py-1">{day}</div>
            )}
            <div className={`flex flex-col ${outgoing ? "items-end" : "items-start"}`}>
              {message.operatorName && (
                <span className="t-caption t-tertiary mr-1 mb-0.5">{message.operatorName}</span>
              )}
              <div
                className={`max-w-[min(560px,84%)] rounded-[14px] px-3 py-2 ${
                  outgoing ? "bg-accent-700 text-white" : "bg-neutral-800 text-text"
                }`}
              >
                <div className="t-body whitespace-pre-wrap break-words">{messageLabel(message)}</div>
                <div className={`t-caption mt-0.5 text-right ${outgoing ? "text-white/70" : "t-tertiary"}`}>
                  {clockAt(message.createdAt, timeZone)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
