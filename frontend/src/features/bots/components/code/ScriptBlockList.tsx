import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import type { BotScriptBlock } from "../../types";

/** The first line with anything on it — a comment header is not what identifies a script. */
function firstLine(source: string): string {
  const line = source
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text !== "" && !text.startsWith("//"));
  return line ?? "";
}

/**
 * Every Kod block in the bot, in one list.
 *
 * The rows link to the flow rather than to the block: the editor initialises
 * with an empty selection and reads nothing out of the URL, so a `?node=` on
 * the end would be a parameter nothing acts on — a link that quietly does less
 * than it says. What the row can do instead is describe the block well enough
 * to be found by eye once the flow is open, which is why the first line of the
 * script is printed under a title that is very often the default "Kod".
 *
 * ## The block this indexes cannot be added
 *
 * The index survived the block. `bots/views.py::_script_blocks` still gathers
 * every node of type `script` out of the bot's graphs, and rows do come back
 * for bots that have them — but that type is in no palette in the flow editor,
 * it is not in `flows/vocabulary.py::NODE_TYPES`, and `engine/runner.py` has no
 * handler for it. So the list is right about what it lists and was wrong about
 * everything else: the empty state used to say a Kod block would appear here
 * once one was added to a flow, which sent a reader hunting through a palette
 * that has no such row, and the footer sent them to a canvas to try code in a
 * field that is not drawn. Both now say what is true today — the file above is
 * where a bot's code lives, and a flow reaches it through its own script.
 *
 * The section stays whatever the answer is. A bot that has these blocks needs
 * to be able to find them, and hiding the list would leave that code with
 * nowhere on the screen at all.
 *
 * No help panel of its own, though the sandbox is the same one. This is an
 * index: nobody is typing here, and the place somebody *is* typing answers for
 * itself — `ScriptHelpPanel`, directly above this list.
 */
export function ScriptBlockList({ blocks }: { blocks: BotScriptBlock[] }) {
  return (
    <ListGroup
      title={blocks.length ? `Kod bloklari · ${blocks.length}` : "Kod bloklari"}
      footer={
        blocks.length
          ? "Bu bloklar oldingi versiyalarda yozilgan — hozir yangisini qo'shib bo'lmaydi. Yangi kod yuqoridagi kutubxonaga yoziladi. Undagi qoidalar va chegaralar bu bloklarga ham tegishli."
          : undefined
      }
    >
      {blocks.length === 0 ? (
        <EmptyState
          icon="code"
          title="Kod bloki yo'q"
          description="Hozircha oqimga alohida «Kod» bloki qo'shilmaydi. Kod yuqoridagi kutubxonada yoziladi — oqim uni o'z skripti va ilgaklari orqali chaqiradi."
        />
      ) : (
        blocks.map((block) => {
          const preview = firstLine(block.source);
          return (
            <Link key={`${block.flowId}:${block.nodeId}`} href={`/flows/${block.flowId}`} className="oq-row">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="t-body truncate">{block.title}</span>
                  {/* The flow is off, so this code does not run — worth saying on
                      a screen whose whole job is "what does this bot compute". */}
                  {!block.flowEnabled && <Badge>O&apos;chiq</Badge>}
                </span>
                <span className="t-footnote t-secondary truncate">
                  {block.flowName} · <span className="font-mono">{`{{${block.variable}}}`}</span>
                </span>
                {preview && <span className="t-caption t-tertiary truncate font-mono">{preview}</span>}
              </span>
              <span className="t-footnote t-tertiary flex-none tabular-nums">{block.lines} qator</span>
              <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
            </Link>
          );
        })
      )}
    </ListGroup>
  );
}
