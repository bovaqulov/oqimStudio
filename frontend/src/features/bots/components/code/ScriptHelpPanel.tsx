"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/utils/cn";
import { AVAILABLE, FORBIDDEN, LIMITS, SNIPPETS, STARTER, alreadyHas, type HelpFact } from "./script-help";
import { byGroup, indexLibrary } from "./library-index";

type Tab = "fayl" | "bor" | "yoq" | "chegara";

const TABS: { value: Tab; label: string }[] = [
  // First, and it is the one that changed what this panel is for. Every new
  // bot now ships with about fifty functions already written; a panel whose
  // opening screen explained the sandbox was answering a question nobody had
  // while leaving «what do I already have» unanswered — and an author who
  // cannot see `money()` writes `pul()`.
  { value: "fayl", label: "Bu faylda" },
  { value: "bor", label: "Nima bor" },
  { value: "yoq", label: "Nima yo'q" },
  { value: "chegara", label: "Chegaralar" },
];

const LISTS: Record<"bor" | "yoq" | "chegara", HelpFact[]> = { bor: AVAILABLE, yoq: FORBIDDEN, chegara: LIMITS };

/** The dot before a fact. Colour is the whole message — there is no room for a second word. */
const DOT: Record<"bor" | "yoq" | "chegara", string> = {
  bor: "bg-success-fg",
  yoq: "bg-danger-fg",
  chegara: "bg-neutral-600",
};

/**
 * One thing that can be put into the editor: a whole file, or one function.
 *
 * `fns` rather than a name, because the starter declares four and the button
 * has to go quiet if *any* of them is already there — a second
 * `function pul(…)` in one file is legal JavaScript, the later one silently
 * wins, and the author would be editing the copy their blocks do not call.
 */
interface Entry {
  id: string;
  label: string;
  hint: string;
  fns: string[];
  code: string;
}

const STARTER_ENTRY: Entry = {
  id: "namuna",
  label: "To'liq namuna",
  hint: "O'z biznesingizni qo'shish: kutubxonadagi funksiyalarni chaqiradigan bitta funksiya va blokda ishlatish namunasi.",
  fns: ["yetkazish"],
  code: STARTER,
};

const ENTRIES: Entry[] = [
  STARTER_ENTRY,
  ...SNIPPETS.map((snippet) => ({
    id: snippet.id,
    label: snippet.label,
    hint: snippet.hint,
    fns: [snippet.fn],
    code: snippet.code,
  })),
];

/**
 * What this file declares, grouped as the file groups it.
 *
 * Read out of `source` on every render rather than kept anywhere: the author is
 * editing that text, and a list that lagged behind it would be wrong at exactly
 * the moment they looked — after adding a function and wondering whether it
 * took. Deriving it costs one pass over a page of source, which is nothing next
 * to being right.
 */
function LibraryList({ source }: { source: string }) {
  const groups = byGroup(indexLibrary(source));
  const total = groups.reduce((count, group) => count + group.entries.length, 0);

  if (!total) {
    return (
      <p className="t-caption t-tertiary m-0 leading-[17px]">
        Bu faylda hali funksiya yo&apos;q. Yuqoridagi tayyor bo&apos;laklardan birini qo&apos;shing yoki
        o&apos;zingiznikini yozing — <code className="font-mono">function nomi(...) {"{ ... }"}</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption t-tertiary m-0 leading-[17px]">
        {total} ta funksiya. Blokda ham, xabar matnida ham nomi bilan chaqiriladi:{" "}
        <code className="font-mono">{"{{ money(cartTotal(savat)) }}"}</code>.
      </p>
      {groups.map((group) => (
        <div key={group.group || "boshqa"} className="flex flex-col gap-1.5">
          {group.group && <h4 className="t-caption t-secondary m-0 font-medium">{group.group}</h4>}
          <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
            {group.entries.map((entry) => (
              <li key={entry.name} className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-[12px] leading-[16px] text-neutral-300 max-md:text-[13px]">
                  {entry.name}
                </span>
                {/* The summary is the author's own comment. Absent for a
                    function somebody added without one — the name alone is
                    still worth listing, because the point of this is that a
                    name exists at all. */}
                {entry.summary && (
                  <span className="t-caption t-tertiary leading-[17px]">{entry.summary}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FactList({ facts, tab }: { facts: HelpFact[]; tab: "bor" | "yoq" | "chegara" }) {
  return (
    <ul className="m-0 grid list-none gap-2.5 p-0 md:grid-cols-2">
      {facts.map((fact) => (
        <li key={fact.term} className="flex gap-2">
          <span className={cn("mt-[6px] h-[5px] w-[5px] flex-none rounded-full", DOT[tab])} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[12px] leading-[16px] text-neutral-300 max-md:text-[13px]">
              {fact.term}
            </span>
            <span className="t-caption t-tertiary leading-[17px]">{fact.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reference card under the library editor.
 *
 * It exists because an empty monospace box is where somebody who is not a
 * programmer stops, and not over syntax: nothing on the screen says what a
 * script may reach, what it may not, or what it is supposed to hand back. The
 * three lists are the answers to those, in the sandbox's own numbers.
 *
 * A segmented control rather than three stacked lists or one disclosure. Three
 * lists at once is the wall of grey 12px text the audit measured; a disclosure
 * closed by default is help nobody opens before they need it, which is after
 * they have already spent twenty minutes on `fetch`. A visible tab reading
 * «Nima yo'q» is a thing somebody hunting for why their code failed can see
 * from the editor.
 *
 * The pieces are chosen first and inserted second. One press that drops code
 * into the file is faster and worse: the reader never sees what arrived, and
 * the fastest way to teach somebody what a function *is* is to show them one,
 * with the sentence that says what it does, before it lands in their file.
 */
export function ScriptHelpPanel({
  source,
  canEdit,
  onInsert,
}: {
  /** The text in the editor right now — what decides which pieces are already in it. */
  source: string;
  canEdit: boolean;
  onInsert: (code: string, label: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("fayl");
  const [chosen, setChosen] = useState(STARTER_ENTRY.id);
  const entry = ENTRIES.find((item) => item.id === chosen) ?? STARTER_ENTRY;
  const present = entry.fns.filter((fn) => alreadyHas(source, fn));

  return (
    <Panel className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-col gap-1">
        <h3 className="t-footnote t-secondary m-0">Qanday yoziladi</h3>
        <p className="t-caption t-tertiary m-0 leading-[17px]">
          Bu yerga faqat <code className="font-mono">function</code> yoziladi. Har bir «Kod» bloki shu
          funksiyalarni nomi bilan chaqiradi, blokdan kelgan qiymatlar esa{" "}
          <code className="font-mono">inputs</code> ichida bo&apos;ladi.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {ENTRIES.map((item) => {
            const active = item.id === entry.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setChosen(item.id)}
                className={cn(
                  "oq-press flex min-h-[32px] cursor-pointer items-center gap-1 rounded-full px-3 text-[12.5px] font-medium whitespace-nowrap max-md:min-h-[38px] max-md:text-[14px]",
                  active ? "bg-accent-700 text-white" : "bg-neutral-800 text-neutral-300",
                )}
              >
                {item.fns.some((fn) => alreadyHas(source, fn)) && <Icon name="check" size={12} />}
                {item.label}
              </button>
            );
          })}
        </div>

        <p className="t-caption t-tertiary m-0 leading-[17px]">{entry.hint}</p>

        <pre className="m-0 max-h-[230px] overflow-auto rounded-[10px] bg-neutral-900 p-2.5 font-mono text-[11.5px] leading-[17px] text-neutral-300 max-md:text-[13px]">
          {entry.code}
        </pre>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={present.length > 0}
              onClick={() => onInsert(entry.code, entry.label)}
            >
              <Icon name="plus" size={16} /> Kodga qo&apos;shish
            </Button>
            {/* Which name, not just "already there": with the full sample the
                overlap is usually one function out of four, and knowing which
                one is the difference between deleting a line and giving up. */}
            {present.length > 0 && (
              <span className="t-caption t-tertiary">
                Kutubxonada allaqachon bor:{" "}
                <span className="font-mono">{present.join(", ")}</span>. Ikkinchi nusxa birinchisini bosib
                qo&apos;yardi.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Segmented options={TABS} value={tab} onChange={setTab} label="Skript haqida" />
        {tab === "fayl" ? <LibraryList source={source} /> : <FactList facts={LISTS[tab]} tab={tab} />}
      </div>
    </Panel>
  );
}
