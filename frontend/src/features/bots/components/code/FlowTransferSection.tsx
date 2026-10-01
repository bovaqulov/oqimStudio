import type { FlowSummary } from "@/features/flows";
import type { FlowSchema } from "@/features/flows/transfer-types";
import { FlowExportList } from "./FlowExportList";
import { FlowImportPanel } from "./FlowImportPanel";
import { SchemaCopyPanel } from "./SchemaCopyPanel";

/**
 * The loop: write the graph somewhere else, bring it here.
 *
 * Until this section the only way to build a flow was by hand on the canvas,
 * one card at a time — which is fine for six blocks and hopeless for forty.
 * The three parts are one journey and are laid out in the order somebody
 * actually does them: paste and import, take a real flow out as the example,
 * and hand the model the vocabulary it would otherwise invent.
 *
 * Each part fails on its own. A schema endpoint that is down does not take the
 * import panel with it, and an empty flow list is not the same fact as a flow
 * list that could not be read — so the two absences are printed differently.
 */
export function FlowTransferSection({
  botId,
  projectId,
  canEdit,
  schema,
  schemaError,
  flows,
  flowsError,
}: {
  botId: string;
  projectId: string;
  canEdit: boolean;
  schema: FlowSchema | null;
  schemaError: string | null;
  flows: FlowSummary[];
  flowsError: string | null;
}) {
  // From the schema and nowhere else: the preview's block names and the names
  // the other model is given have to be the same words, or the count the author
  // reads before importing is in a vocabulary the graph was not written in.
  const typeLabels = Object.fromEntries((schema?.nodeTypes ?? []).map((node) => [node.type, node.label]));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 px-1">
        <h2 className="t-footnote t-secondary m-0">JSON orqali oqim</h2>
        <p className="t-footnote t-tertiary m-0 leading-[18px]">
          Katta oqimni kanvasda blok-blok chizish shart emas: grafikni boshqa AI da yozdiring va shu yerda
          tekshirib import qiling. Halqa uch qadam — lug&apos;atni nusxalash, tayyor oqimni namuna qilib
          yuklab olish, javobni shu yerga qo&apos;yish.
        </p>
      </div>

      <FlowImportPanel botId={botId} projectId={projectId} canEdit={canEdit} typeLabels={typeLabels} />

      {flowsError ? (
        <p className="t-footnote t-tertiary m-0 px-1">Oqimlar ro&apos;yxatini o&apos;qib bo&apos;lmadi: {flowsError}</p>
      ) : (
        <FlowExportList flows={flows} />
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 px-1">
          <h3 className="t-footnote t-secondary m-0">Bloklar lug&apos;ati</h3>
          <p className="t-footnote t-tertiary m-0 leading-[18px]">
            Boshqa AI ga birinchi bo&apos;lib shuni bering: blok turlari, chiqish nomlari va maydonlar. Busiz
            u nomlarni o&apos;ylab topadi, grafik esa tekshiruvdan o&apos;tmaydi.
          </p>
        </div>
        {schema ? (
          <SchemaCopyPanel schema={schema} />
        ) : (
          <p className="t-footnote t-tertiary m-0 px-1">
            Lug&apos;atni o&apos;qib bo&apos;lmadi{schemaError ? `: ${schemaError}` : "."}
          </p>
        )}
      </div>
    </section>
  );
}
