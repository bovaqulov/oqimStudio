import { Icon } from "@/components/ui/Icon";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { cn } from "@/lib/utils/cn";
import type { DmsTriggerConfig, DmsTriggerKind, KeywordMatch } from "@/features/flows";
import {
  SUBSUMED_BY_ANY,
  TRIGGER_FAMILIES,
  dmsKinds,
  familiesOfKinds,
  getTriggerFamily,
  triggerConfigForFamily,
  triggerKindMeta,
  type TriggerFamilyMeta,
} from "../../../lib/trigger";
import { CommandInput } from "./CommandInput";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { KeywordField } from "./KeywordField";
import { RevealPanel } from "./RevealPanel";

const LOCKED_HINT = "«Istalgan xabar» barcha xabarlarni qamrab oladi — avval uni olib tashlang.";

function toggle(list: DmsTriggerKind[], key: DmsTriggerKind): DmsTriggerKind[] {
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

/**
 * What fires the flow's Handler. The block answers one *family* of entry —
 * commands, keywords, media… — which is what makes a flow nameable: "the one
 * that runs on «narx»" is a flow, "the one that runs on four unrelated things"
 * is a pile.
 *
 * A config saved before this (or one built by hand) can still span families.
 * That state is shown as-is, every family with its own editor, rather than
 * silently rewritten — splitting it is now a matter of moving branches into a
 * flow of their own (see `ExtractFlowField`), since a flow holds one Handler.
 */
export function DmsTriggerField({
  dms,
  onChange,
}: {
  dms?: DmsTriggerConfig;
  onChange: (config: DmsTriggerConfig) => void;
}) {
  const kinds = dmsKinds(dms);
  const families = familiesOfKinds(kinds);
  const mixed = families.length > 1;
  const activeFamily = families[0] ?? "command";
  // Tolerates configs written before the slash moved out of the stored value.
  const command = (dms?.command ?? "").replace(/^\/+/, "");
  const keywords = dms?.keywords ?? "";
  const keywordMatch: KeywordMatch = dms?.keywordMatch ?? "contains";
  const keywordFlags = dms?.keywordFlags ?? "i";
  const anySelected = kinds.includes("any");

  function commit(patch: Partial<DmsTriggerConfig>) {
    onChange({ kinds, command, keywords, keywordMatch, keywordFlags, ...patch });
  }
  function toggleKind(key: DmsTriggerKind) {
    let next = toggle(kinds, key);
    // Switching "Istalgan xabar" on drops what it swallows, so a saved trigger
    // can never carry two rules that contradict each other.
    if (key === "any" && next.includes("any")) next = next.filter((kind) => !SUBSUMED_BY_ANY.has(kind));
    // A Handler with nothing selected would silently fall back to the module
    // default, so the last chip in a family stays on.
    if (!next.length) return;
    commit({ kinds: next });
  }

  /**
   * The conditions of a family this block may actually pick between. A
   * reserved one stays listed on the block that already carries it — hiding it
   * would leave that Handler showing an empty family — but is never offered:
   * /start is a block type of its own now, and the main flow already has the
   * one that answers it.
   */
  function choices(items: DmsTriggerKind[]) {
    return items.filter((key) => !triggerKindMeta(key).reserved || kinds.includes(key));
  }

  function chips(items: DmsTriggerKind[]) {
    return items.map((key) => {
      const meta = triggerKindMeta(key);
      const locked = anySelected && SUBSUMED_BY_ANY.has(key);
      return (
        <ToggleChip
          key={key}
          active={kinds.includes(key)}
          disabled={locked}
          title={locked ? LOCKED_HINT : meta.api}
          onClick={() => toggleKind(key)}
        >
          {meta.label}
        </ToggleChip>
      );
    });
  }

  function familyBody(meta: TriggerFamilyMeta) {
    if (meta.key === "any") {
      return <FieldHint>Boshqa hech qaysi oqim ushlamagan xabarlar shu oqimga tushadi.</FieldHint>;
    }
    if (meta.key === "keyword") {
      return (
        <KeywordField keywords={keywords} match={keywordMatch} flags={keywordFlags} onChange={(patch) => commit(patch)} />
      );
    }
    const options = choices(meta.kinds);
    return (
      <>
        {/* One choice is not a choice: the family button above already named
            it, and a chip that cannot be switched off says nothing twice. */}
        {options.length > 1 && <div className="flex flex-wrap gap-1.5">{chips(options)}</div>}
        {meta.key === "command" && kinds.includes("command") && (
          <RevealPanel>
            <FieldLabel>Buyruq nomi</FieldLabel>
            <CommandInput value={command} reserved={["start"]} onChange={(next) => commit({ command: next })} />
          </RevealPanel>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-800/40 p-[11px]">
      <div className="flex flex-col gap-1.5">
        {/* The field names the thing the block is. «Handler turi» was the
            fourth word this product used for one idea — the block says
            «Boshlanish sharti», the card says «Buyruqlar», the main flow says
            «start» — and the only one of the four that is not Uzbek. */}
        <span className="text-[11px] max-md:text-[13px] text-neutral-400">Boshlanish sharti</span>
        <div className="grid grid-cols-3 gap-1.5">
          {TRIGGER_FAMILIES.filter(
            // A hidden family still earns its tab on the one Handler that
            // already uses it — hiding a block's own current config would read
            // as data loss, and switching away is how an author retires it.
            (meta) => !meta.hidden || families.includes(meta.key),
          ).map((meta) => {
            const active = !mixed && meta.key === activeFamily;
            return (
              <button
                key={meta.key}
                type="button"
                title={meta.hint}
                onClick={() => onChange(triggerConfigForFamily(dms, meta.key))}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1 rounded-md border px-1 py-[7px] text-[9.5px] max-md:text-[12px] transition-colors",
                  active
                    ? "border-accent-600 bg-accent-900/50 text-accent-200"
                    : "border-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300",
                )}
              >
                <Icon name={meta.icon} size={13} />
                <span className="w-full truncate text-center">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {mixed ? (
        <div className="flex flex-col gap-2 border-t border-neutral-900 pt-[10px]">
          <span className="flex items-center gap-1.5 text-[11px] max-md:text-[13px] text-warning-fg">
            <Icon name="warning" size={12} />
            Aralash shartlar
          </span>
          <FieldHint>
            Bu blok {families.length} xil turdagi shartni ushlaydi:{" "}
            {families.map((key) => getTriggerFamily(key).label).join(", ")}. Har birini alohida oqimga chiqarsangiz,
            oqim nomi ham, ustuvorlik ham aniq bo&apos;ladi.
          </FieldHint>
          {families.map((key) => {
            const meta = getTriggerFamily(key);
            return (
              <div key={key} className="flex flex-col gap-1.5 border-t border-neutral-900 pt-[10px]">
                <span className="text-[11px] max-md:text-[13px] text-neutral-400">{meta.label}</span>
                {familyBody(meta)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 border-t border-neutral-900 pt-[10px]">
          {familyBody(getTriggerFamily(activeFamily))}
        </div>
      )}
    </div>
  );
}
