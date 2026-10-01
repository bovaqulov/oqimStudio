"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { showToast } from "@/components/ui/toast-store";
import { cn } from "@/lib/utils/cn";
import type { FlowNode } from "@/features/flows";
// Straight from the action module, not the feature's barrel: the barrel also
// re-exports the repository, and importing that from a client component would
// drag the whole flow store into the browser bundle.
import { extractFlowAction } from "@/features/flows/actions";
import { planFlowExtraction } from "../../../lib/extract-flow";
import { getNodeDefinition } from "../../../node-registry";
import { useFlowEditorStore } from "../../../store/useFlowEditorStore";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { RevealPanel } from "./RevealPanel";

/**
 * Moving one entry block and the blocks only it uses into a flow of their own.
 *
 * Offered on the block that opens the branch, because that block is the one
 * thing the whole branch can be named by — and never on the block the flow
 * owns: a flow's own Handler opens everything in it, so there is no separate
 * half under it to move out (see `node-registry.ts`, `applyEntryRule`). What is
 * left is the modules whose entries are ordinary blocks, `groups`/`channels`,
 * where one canvas can still hold several of them.
 *
 * What would move is counted before anything happens — a split that quietly
 * takes a block the rest of the flow still needs is worse than no split at all,
 * so the blocks that stay are named here rather than discovered afterwards.
 */
export function ExtractFlowField({ node }: { node: FlowNode }) {
  const router = useRouter();
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const flowId = useFlowEditorStore((s) => s.flowId);
  const flowName = useFlowEditorStore((s) => s.name);
  const projectId = useFlowEditorStore((s) => s.projectId);
  const botId = useFlowEditorStore((s) => s.botId);
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  const applyExtraction = useFlowEditorStore((s) => s.applyExtraction);
  const flushSave = useFlowEditorStore((s) => s.flushSave);

  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  /**
   * Splitting a flow is not undoable, so it is asked about — but asked *here*.
   * A `window.confirm` fired from the expanded block editor is a second dialog
   * over the first, and the one thing it takes away is the panel listing what
   * would move.
   */
  const [confirming, setConfirming] = useState(false);

  const plan = planFlowExtraction(nodes, edges, node.id, { flowId: flowId ?? "", flowName });
  if (!plan || !flowId || !projectId || !botId || !moduleKey) return null;

  const name = node.title.trim() || getNodeDefinition(node.type).kindLabel;
  // Nothing is split by moving everything — the two flows would be the old one
  // and an empty canvas.
  const blocked = plan.movedIds.length === nodes.length;

  const others = plan.movedIds.length - 1;
  const moving = others ? `«${name}» va u bilan bog'liq ${others} ta blok` : `«${name}» bloki`;

  // An arrow rather than a declaration: it is created after the guard above, so
  // it reads the narrowed ids instead of re-checking every one of them.
  const extract = () => {
    setConfirming(false);
    startTransition(async () => {
      setFailed(false);
      try {
        const created = await extractFlowAction({
          projectId,
          botId,
          moduleKey,
          name,
          nodes: plan.nodes,
          edges: plan.edges,
        });
        // The new flow was created *with* the moved blocks, so it already holds
        // them; what is left is to take them out of this one.
        applyExtraction(plan.movedIds);
        flushSave();
        showToast(`"${name}" alohida oqimga ajratildi`);
        router.push(`/flows/${created.id}`);
      } catch {
        // The blocks are still here — nothing was dropped before the new flow
        // came back, so the only thing to undo is the message.
        setFailed(true);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Alohida oqim</FieldLabel>

      <div className="flex flex-col gap-1 rounded-md bg-neutral-900/70 px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[10.5px] max-md:text-[12px] text-neutral-400">
          <Icon name="arrow-elbow-down-right" size={11} className="flex-none text-accent-300" />
          {plan.movedIds.length} ta blok ko&apos;chadi
        </span>
        {plan.kept.length > 0 && (
          <span className="text-[10px] max-md:text-[12px] leading-relaxed text-neutral-600">
            {plan.kept.map((target) => `«${target.title}»`).join(", ")} shu oqimda qoladi — boshqa kirish bloki ham
            ishlatadi. O&apos;rniga aynan o&apos;sha blokka o&apos;tish bloki qo&apos;yiladi.
          </span>
        )}
      </div>

      {confirming ? (
        <RevealPanel>
          <p className="text-[11px] max-md:text-[13px] leading-relaxed text-neutral-300">
            {moving} &laquo;{flowName}&raquo; oqimidan alohida oqimga ko&apos;chiriladi. Davom etamizmi?
          </p>
          <div className="flex items-center gap-1.5">
            <span className="flex-1" />
            <Button variant="ghost" className="px-2.5 py-1 text-[11.5px] max-md:text-[13px]" onClick={() => setConfirming(false)}>
              Bekor qilish
            </Button>
            <Button variant="primary" className="px-2.5 py-1 text-[11.5px] max-md:text-[13px]" onClick={extract}>
              Ajratish
            </Button>
          </div>
        </RevealPanel>
      ) : (
        <button
          type="button"
          disabled={pending || blocked}
          onClick={() => setConfirming(true)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md border px-2 py-[7px] text-[11.5px] max-md:text-[13px] transition-colors",
            blocked || pending
              ? "cursor-not-allowed border-neutral-800 text-neutral-600"
              : "cursor-pointer border-neutral-700 bg-neutral-800 text-neutral-200 hover:border-accent-600 hover:text-accent-200",
          )}
        >
          <Icon name={pending ? "clock" : "git-branch"} size={12} className="flex-none" />
          {pending ? "Ajratilmoqda…" : "Alohida oqimga ajratish"}
        </button>
      )}

      {failed && (
        <p className="flex items-start gap-1.5 text-[10.5px] max-md:text-[12px] leading-relaxed text-danger-fg">
          <Icon name="warning" size={11} className="mt-[2px] flex-none" />
          Oqim yaratilmadi — bloklar shu yerda qoldi. Qayta urinib ko&apos;ring.
        </p>
      )}

      <FieldHint>
        {blocked
          ? "Butun oqim shu blokdan boshlanadi — ajratadigan alohida qism yo'q."
          : "Yangi oqim shu blok nomi bilan yaratiladi va darhol ochiladi."}
      </FieldHint>
    </div>
  );
}
