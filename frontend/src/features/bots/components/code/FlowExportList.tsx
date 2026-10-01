import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import type { FlowSummary } from "@/features/flows";
import { getModuleDefinition } from "../../modules";

/**
 * The bot's flows, each one a file.
 *
 * A plain `<a>` and not a `Link`: the answer arrives with
 * `Content-Disposition: attachment`, so the browser saves it and leaves the
 * reader where they were. Routing it through the client router would ask Next
 * to render a file as a page.
 *
 * The download is not a convenience feature, whatever it looks like. It is the
 * worked example somebody feeds the model that will write the next graph — one
 * real flow of this bot's own, in the exact shape the importer accepts — and it
 * is what turns "describe a bot flow in JSON" into a request with an answer
 * that validates. The copy above it explains that, because a row saying only
 * "yuklab olish" gets used by nobody who has not already been told.
 */
export function FlowExportList({ flows }: { flows: FlowSummary[] }) {
  return (
    <ListGroup
      title={flows.length ? `Eksport · ${flows.length}` : "Eksport"}
      footer={
        flows.length
          ? "Yuklab olingan JSON ni boshqa AI ga namuna qilib bering — u shu ko'rinishda grafik yozadi."
          : undefined
      }
    >
      {flows.length === 0 ? (
        <EmptyState
          icon="download-simple"
          title="Eksport qiladigan oqim yo'q"
          description="Birinchi oqim yaratilgach, u shu yerdan JSON bo'lib yuklanadi."
        />
      ) : (
        flows.map((flow) => (
          <a key={flow.id} href={`/api/flows/${flow.id}/export`} className="oq-row">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="t-body truncate">{flow.name}</span>
                {flow.isMain && <Badge tone="accent">Asosiy</Badge>}
              </span>
              <span className="t-footnote t-secondary truncate">
                {getModuleDefinition(flow.moduleKey).name} · {flow.updatedAt}
              </span>
            </span>
            <Icon name="download-simple" size={17} className="flex-none text-neutral-500" />
          </a>
        ))
      )}
    </ListGroup>
  );
}
