import { Icon } from "@/components/ui/Icon";
import { ToastButton } from "@/components/ui/ToastButton";
import { FlowRow } from "@/features/flows/components/FlowRow";
import { FLOW_MENU_ITEM_CLASS, FlowRowMenu } from "@/features/flows/components/FlowRowMenu";
import { FlowTestButton } from "@/features/flow-kit";
import { isFlowEmpty, type FlowRecord } from "@/features/flows";

/**
 * A flow in a module's list: the shared [[FlowRow]], plus the things you can do
 * to it behind one "⋯".
 *
 * The card this replaces was three stacked lines — name, description, then a
 * strip carrying the run count, "Sinash", "Tahrirlash" and a menu — so four
 * flows filled a phone screen and the home screen listed the same flows in a
 * third of the height. "Sinash" moved into the menu with everything else: it is
 * the most-used entry there and so it leads, but a row with a switch, a button
 * and a menu on its right is three targets inside 120px.
 *
 * The menu itself is [[FlowRowMenu]], shared with the home screen. What is left
 * here leads it: "Sinash" needs the flow's blocks, which is why it can only be
 * offered from the list that reads whole records.
 */
export function ModuleFlowCard({ flow }: { flow: FlowRecord }) {
  const empty = isFlowEmpty(flow);

  return (
    <FlowRow
      flow={flow}
      empty={empty}
      trailing={
        <FlowRowMenu flow={flow}>
          {/* A flow with no blocks has nothing to simulate — the test chat would
              open on an empty conversation and teach the author nothing. */}
          {!empty && (
            <FlowTestButton
              flowId={flow.id}
              flowName={flow.name}
              nodes={flow.nodes}
              edges={flow.edges}
              className={FLOW_MENU_ITEM_CLASS}
            />
          )}
          <ToastButton message={`${flow.name} · nusxa yaratildi`} className={FLOW_MENU_ITEM_CLASS}>
            <Icon name="copy" size={16} /> Nusxalash
          </ToastButton>
        </FlowRowMenu>
      }
    />
  );
}
