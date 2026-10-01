"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import type { FlowNode, MediaKind } from "@/features/flows";
import { resolveText } from "@/features/flows/localized-text";
import { TRANSITION_LABELS } from "../../lib/transitions";
import { summarizeCondition } from "../../lib/condition";
import { getContentDefinition, nodeContentKind } from "../../lib/message-content";
import { summarizeTagAction } from "../../lib/tag";
import { nodeAiConfig } from "../../lib/ai";
import { businessAutoTitle, findTriggerConflicts } from "../../lib/trigger";
import {
  acceptsIncomingEdge,
  buttonsUnsupportedReason,
  getNodeDefinition,
  hasBackRow,
  isFixedNodeType,
  usesDmsTrigger,
} from "../../node-registry";
import { useFlowEditorStore } from "../../store/useFlowEditorStore";
import { ADVANCED_SECTION_TITLE, foldsAway, type NodeFieldSlot } from "./fields/advanced-fields";
import { AiConfigField } from "./fields/AiConfigField";
import { AnswerTypeField } from "./fields/AnswerTypeField";
import { BackRowField } from "./fields/BackRowField";
import { BodyField } from "./fields/BodyField";
import { CollapsibleSection } from "./fields/CollapsibleSection";
import { BusinessTriggerField } from "./fields/BusinessTriggerField";
import { BusinessTriggerSummary } from "./fields/BusinessTriggerSummary";
import { ButtonsField } from "./fields/ButtonsField";
import { ConditionField } from "./fields/ConditionField";
import { DelayField } from "./fields/DelayField";
import { DmsTriggerField } from "./fields/DmsTriggerField";
import { ExtractFlowField } from "./fields/ExtractFlowField";
import { FieldHint } from "./fields/FieldHint";
import { IncomingTransitionField } from "./fields/IncomingTransitionField";
import { FlowLinkField, type FlowLinkOption } from "./fields/FlowLinkField";
import { LanguageField } from "./fields/LanguageField";
import { MediaField } from "./fields/MediaField";
import { MessageContentFields } from "./fields/MessageContentFields";
import { PriorityField } from "./fields/PriorityField";
import { SaveAnswerField } from "./fields/SaveAnswerField";
import { TableReadField } from "./fields/TableReadField";
import { TableWriteField } from "./fields/TableWriteField";
import { TagActionField } from "./fields/TagActionField";
import { useBotMainLanguage } from "./fields/TextLanguage";
import { TitleField } from "./fields/TitleField";

/** What a jump block says on the canvas — its destination, flow then block. */
function flowLinkText(flowName: string, blockTitle?: string): string {
  return [flowName, blockTitle].filter(Boolean).join(" · ");
}

/**
 * A working first draft for a block's own text, offered while the field is
 * empty. A real sentence rather than "Matnni shu yerga yozing": what an author
 * is stuck on is the shape of the thing, and one example of the shape unsticks
 * it faster than a label describing it does.
 */
const BODY_SAMPLES: Partial<Record<string, string>> = {
  ai: "Sen — kompaniyaning yordamchisisan. Mijoz savoliga qisqa va aniq javob ber.",
};

/** How a folded-away media attachment reads on the closed drawer. */
const MEDIA_SUMMARY: Record<MediaKind, string> = {
  photo: "Rasm",
  video: "Video",
  audio: "Audio",
  voice: "Ovozli xabar",
  document: "Hujjat",
};

/**
 * Every editable field for one block, in order. Rendered both by the docked
 * Inspector and by the expanded editor modal, so the two can never drift.
 *
 * `docked` is the one thing they do not share. A field that needs more room
 * than 270px gives it reads there instead of edits — it shows what is set and
 * opens the modal — rather than being run twice at two different qualities.
 */
export function NodeFields({
  node,
  siblingFlows,
  docked = false,
}: {
  node: FlowNode;
  siblingFlows: FlowLinkOption[];
  /** Rendered in the narrow side panel rather than in the expanded editor. */
  docked?: boolean;
}) {
  const main = useBotMainLanguage();
  const moduleKey = useFlowEditorStore((s) => s.moduleKey);
  const patchNode = useFlowEditorStore((s) => s.patchNode);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const expandNode = useFlowEditorStore((s) => s.expandNode);
  const definition = getNodeDefinition(node.type);
  const content = definition.hasContent ? getContentDefinition(nodeContentKind(node)) : null;
  // Two different reasons a keyboard block shows no editor: the module never
  // delivers one (business), or this content kind takes none (album).
  const noButtonsInModule = buttonsUnsupportedReason(node.type, moduleKey);
  const conflicts = useMemo(
    () => (definition.hasTriggerConfig ? findTriggerConflicts(nodes).get(node.id) : undefined),
    [definition.hasTriggerConfig, nodes, node.id],
  );

  function patch(value: Partial<FlowNode>) {
    patchNode(node.id, value);
  }

  /**
   * Controls held back for the drawer at the foot of the panel. Filled as the
   * panel below is built and read once at the end — which is why the drawer is
   * the last thing in the returned tree, and has to stay there.
   */
  const advanced: { key: string; element: ReactNode; summary?: string }[] = [];

  /**
   * One control, placed. A block leads with at most three questions and
   * everything else folds away; which of the two a control is belongs to the
   * table in [[foldsAway]], so nothing here branches on the block type.
   *
   * `summary` is what the closed drawer says about it. A drawer may hide a
   * control, never the fact that it is set — a folded priority of 2 with no
   * sign of it on the header is a setting nobody will ever find again.
   */
  function place(slot: NodeFieldSlot, key: string, element: ReactNode, summary?: string): ReactNode {
    if (!foldsAway(node.type, slot)) return element;
    advanced.push({ key, element, summary });
    return null;
  }

  return (
    <>
      {/* A Handler's name is worth generating and not worth storing unasked: the
          placeholder shows what the block would be called, and stays a
          placeholder until somebody types over it.

          The flow's own entry block gets no name field at all. It is not a block
          an author added — it is the one the main flow is built around, it
          cannot be deleted, and the only thing it does is answer `/start`. A
          «Blok nomi» field on it offered to rename a thing whose name *is* the
          command it answers, and it was the sole occupant of the drawer below,
          so a block with nothing to configure opened on «Qo'shimcha sozlamalar».
          It now opens on the one sentence that is true of it. */}
      {!(isFixedNodeType(node.type) && !definition.hasTriggerConfig) &&
        place(
          "title",
          "title",
          <TitleField
            value={node.title}
            placeholder={
              definition.hasTriggerConfig && moduleKey === "business" ? businessAutoTitle(node.business) : undefined
            }
            onChange={(title) => patch({ title })}
          />,
          // Deliberately no summary: the block's name is already the heading of
          // the panel this drawer sits in, so echoing it here printed
          // "Qo'shimcha sozlamalar · Savol" under a sheet titled "Savol".
          undefined,
        )}

      {/* Both entry blocks say they belong to the flow rather than to the
          author — but only /start has nothing at all to set, which is why it is
          the one that also explains what it answers. A Handler's condition is
          right below, so the note stays to the one thing that is not obvious
          from the panel: this block is here to stay. */}
      {/* Only the block with nothing else to say keeps its sentence. A Handler
          opens straight on its condition — the paragraph that used to sit here
          restated what the panel below already asks, and "cannot be deleted"
          is said by the toast at the moment somebody actually tries. */}
      {isFixedNodeType(node.type) && !definition.hasTriggerConfig && (
        <FieldHint>
          Bu blok «{definition.kindLabel}» buyrug&apos;iga javob beradi — sharti o&apos;zgarmaydi va blok
          o&apos;chirilmaydi. Javobni quyidagi bloklarga ulang.
        </FieldHint>
      )}

      {/* A block that has nothing to configure still owes the author a sentence
          — see [[NodeTypeDefinition.hint]]. Read off the definition rather than
          branched on the type, so the next such block is a table entry like
          every other part of a block type. */}
      {definition.hint && <FieldHint>{definition.hint}</FieldHint>}

      {definition.hasMedia &&
        place(
          "media",
          "media",
          <MediaField value={node.media} onChange={(media) => patch({ media })} />,
          node.media ? MEDIA_SUMMARY[node.media] : undefined,
        )}

      {definition.hasFlowLink ? (
        <FlowLinkField
          options={siblingFlows}
          selectedId={node.target}
          selectedBlockId={node.targetNodeId}
          // The card and the simulator both read `text`, so the destination is
          // written there in full — flow and block in one patch, since picking
          // another flow always brings a block of that flow with it.
          onSelect={(target, block) => {
            const targetName = siblingFlows.find((f) => f.id === target)?.name ?? resolveText(node.text, main, main);
            patch({ target, targetNodeId: block?.id, text: flowLinkText(targetName, block?.title) });
          }}
          onSelectBlock={(block) => {
            const targetName = siblingFlows.find((f) => f.id === node.target)?.name ?? "";
            patch({ targetNodeId: block.id, text: flowLinkText(targetName, block.title) });
          }}
        />
      ) : definition.hasCondition ? (
        <ConditionField
          value={node.condition}
          onChange={(condition) => patch({ condition, text: summarizeCondition(condition) })}
        />
      ) : definition.hasTagAction ? (
        <TagActionField
          action={node.tagAction ?? "add"}
          name={node.tagName ?? ""}
          value={node.tagValue ?? ""}
          onChange={(next) => {
            const tagAction = next.tagAction ?? node.tagAction ?? "add";
            const tagName = next.tagName ?? node.tagName ?? "";
            const tagValue = next.tagValue ?? node.tagValue ?? "";
            patch({ ...next, text: summarizeTagAction(tagAction, tagName, tagValue) });
          }}
        />
      ) : definition.hasTableRead ? (
        <TableReadField
          value={node.tableRead ?? { handle: "", column: "", value: "", into: "qator" }}
          onChange={(next) => {
            const read = next.tableRead;
            patch({
              ...next,
              text: read.handle
                ? `«${read.handle}» dan ${read.column ? `${read.column} bo'yicha` : "oxirgi"} qator`
                : "Ma'lumot tanlanmagan",
            });
          }}
        />
      ) : definition.hasTableWrite ? (
        <TableWriteField
          value={node.tableWrite ?? { handle: "", values: {} }}
          onChange={(next) => {
            // The card's one line, kept in step with the settings the way every
            // other configured block does it: `text` is what the canvas and
            // Simple mode read back, so a block whose table changed and whose
            // caption did not would be a card describing the last choice.
            const write = next.tableWrite;
            const filled = Object.keys(write.values).length;
            patch({
              ...next,
              text: write.handle
                ? `«${write.handle}» ma'lumotiga ${filled} ta maydon yoziladi`
                : "Ma'lumot tanlanmagan",
            });
          }}
        />
      ) : definition.hasContent ? (
        <MessageContentFields node={node} onPatch={patch} />
      ) : definition.bodyFieldLabel ? (
        <BodyField
          label={node.media ? "Caption" : definition.bodyFieldLabel}
          value={node.text}
          onChange={(text) => patch({ text })}
          markdown={definition.supportsMarkdown}
          sample={BODY_SAMPLES[node.type]}
        />
      ) : null}

      {/* Directly under the question itself, and not behind «Qo'shimcha»: what
          is being asked and where the answer goes are one decision. A question
          whose answer lands nowhere is the failure this block was added to fix,
          so the field that says where is not something to go looking for. */}
      {definition.hasSaveAnswer && (
        <SaveAnswerField value={node.saveAnswerAs ?? ""} onChange={(saveAnswerAs) => patch({ saveAnswerAs })} />
      )}
      {definition.hasAnswerType && (
        <AnswerTypeField value={node.answerType} onChange={(answerType) => patch({ answerType })} />
      )}
      {definition.hasBackRowOnly && <BackRowField node={node} onPatch={patch} />}

      {/* A language picker sends its own keyboard, so what the author edits is
          the thing the keyboard is built from — the languages — not the rows. */}
      {definition.hasLanguage && <LanguageField node={node} onChange={(language) => patch({ language })} />}

      {definition.hasButtons &&
        (noButtonsInModule ? (
          <FieldHint className="rounded-md border border-dashed border-neutral-800 p-2">{noButtonsInModule}</FieldHint>
        ) : content && !content.supportsButtons ? (
          <>
            <FieldHint className="rounded-md border border-dashed border-neutral-800 p-2">
              Media albom Telegram&apos;da tugmalarni qo&apos;llab-quvvatlamaydi.
            </FieldHint>
            {/* The one control that survives the missing keyboard editor, and
                only while the block still carries the row: a Xabar converted to
                an album keeps its «Orqaga» row, its `back` port and the branch
                off it, and this used to be the moment the author lost every way
                of touching any of the three. Hidden when there is no row,
                because offering to add one here would be offering a row this
                block cannot send. */}
            {hasBackRow(node) && <BackRowField node={node} onPatch={patch} />}
          </>
        ) : (
          <ButtonsField node={node} onPatch={patch} />
        ))}

      {/* The block's answer for every connection wired into it. The per-line
          setting lives on the line, which is the honest place for it; this is
          the shortcut for a block reachable from ten of them. */}
      {definition.hasIncomingTransition &&
        place(
          "incomingTransition",
          "incomingTransition",
          <IncomingTransitionField node={node} onChange={(value) => patch({ incomingTransition: value })} />,
          node.incomingTransition ? TRANSITION_LABELS[node.incomingTransition] : undefined,
        )}

      {definition.hasAiConfig && (
        <AiConfigField
          value={nodeAiConfig(node)}
          siblingFlows={siblingFlows}
          onChange={(ai) => patch({ ai })}
        />
      )}

      {definition.hasDelay &&
        place(
          "delay",
          "delay",
          <DelayField
            minutes={node.minutes ?? 0}
            label={definition.delayLabel}
            onChange={(minutes) => patch({ minutes })}
          />,
          node.minutes ? `${node.minutes} daqiqa` : undefined,
        )}
      {definition.hasTriggerConfig &&
        moduleKey === "business" &&
        (docked ? (
          <BusinessTriggerSummary business={node.business} onExpand={() => expandNode(node.id)} />
        ) : (
          <BusinessTriggerField business={node.business} onChange={(business) => patch({ business })} />
        ))}
      {definition.hasTriggerConfig && usesDmsTrigger(moduleKey) && (
        <DmsTriggerField dms={node.dmsTrigger} onChange={(dmsTrigger) => patch({ dmsTrigger })} />
      )}
      {/* Only Handlers race each other for an incoming update, so only they carry a priority. */}
      {definition.hasTriggerConfig &&
        place(
          "priority",
          "priority",
          <PriorityField
            node={node}
            siblings={nodes}
            conflicts={conflicts}
            onChange={(priority) => patch({ priority })}
          />,
          // A conflict is the one thing a closed drawer must not swallow: it
          // says this Handler and another are racing for the same update.
          conflicts?.length ? "Ziddiyat" : node.priority !== undefined ? `Navbat ${node.priority}` : undefined,
        )}
      {/* Only a block that opens a flow can open a flow of its own — and not the
          one the flow owns: a Handler's blocks are the whole flow, so there is
          nothing under it to split off. */}
      {!acceptsIncomingEdge(node.type) &&
        !isFixedNodeType(node.type) &&
        place("extract", "extract", <ExtractFlowField node={node} />)}

      {/* Everything the block can do that it does not lead with, behind one
          heading. Last in the tree because `place` fills the list as the panel
          above is built. */}
      {advanced.length > 0 && (
        <CollapsibleSection
          title={ADVANCED_SECTION_TITLE}
          summary={advanced
            .map((item) => item.summary)
            .filter(Boolean)
            .join(" · ")}
        >
          {advanced.map((item) => (
            <Fragment key={item.key}>{item.element}</Fragment>
          ))}
        </CollapsibleSection>
      )}
    </>
  );
}
