import type { EdgeTransition, FlowNode } from "@/features/flows";
import { TRANSITION_HINTS, TRANSITION_LABELS, TRANSITION_LADDER } from "../../../lib/transitions";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { TransitionChoice } from "./TransitionChoice";

/**
 * The block's answer for every connection wired into it.
 *
 * The per-connection setting lives on the line itself, which is the honest
 * place for it — the same pair of blocks can mean different things depending on
 * how the reader arrived. This is the shortcut for when they do not: a menu
 * reachable from ten places should not have to be configured ten times, and a
 * graph where nine of those agree and the tenth was forgotten is worse than one
 * that was never configured at all.
 *
 * The same rows as the connection panel, and not the segmented control this
 * used to be: four labels do not fit across 296px, and a control that has to
 * abbreviate «Tugmasiz qoldirish» to fit is a control nobody can read.
 *
 * "Avtomatik" is not a fifth transition — it hands the decision back to the
 * built-in rule, which the connection panel deliberately does not offer because
 * a line has to say what it *does*. Here it is the honest default: a block with
 * no opinion about how it is reached.
 */
export function IncomingTransitionField({
  node,
  onChange,
}: {
  node: FlowNode;
  onChange: (value: EdgeTransition | undefined) => void;
}) {
  const value = node.incomingTransition;

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Bu blok ochilganda avvalgi xabar</FieldLabel>
      <div className="flex flex-col gap-1">
        <TransitionChoice
          label="Avtomatik"
          hint="Menyu ekranining o'rnini oladi, oddiy xabarni esa joyida qoldiradi."
          transition="keep"
          selected={value === undefined}
          disabled={false}
          onSelect={() => onChange(undefined)}
        />
        {TRANSITION_LADDER.map((transition) => (
          <TransitionChoice
            key={transition}
            label={TRANSITION_LABELS[transition]}
            hint={TRANSITION_HINTS[transition]}
            transition={transition}
            selected={value === transition}
            disabled={false}
            onSelect={() => onChange(transition)}
          />
        ))}
      </div>
      {/* No per-block seconds field: a delay belongs to one line, and a block
          cannot know which of ten incoming ones is worth pausing for. */}
      <FieldHint>
        Alohida chiziq buni o&apos;zi uchun bekor qilishi mumkin — chiziqni bosing. «O&apos;chirish» bu yerdan
        darhol o&apos;chiradi; kechikish faqat chiziqda sozlanadi.
      </FieldHint>
    </div>
  );
}
