import Link from "next/link";
import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { ListGroup } from "@/components/ui/List";
import { ToastButton } from "@/components/ui/ToastButton";
import { getIntegrationStage, INTEGRATIONS, type IntegrationRowData } from "@/features/integrations/data";

/**
 * One integration, as a row: what it is, what it does in one line, and — for
 * the ones that have not shipped — how far along it is.
 *
 * The three shapes are the three things a row can honestly offer. Somewhere to
 * go, so the whole row goes there; something that already works but is
 * configured inside a flow, so the row states it and does nothing; or nothing
 * yet, so the row is the waiting list and says so when it is tapped.
 */
function IntegrationRow({ integration }: { integration: IntegrationRowData }) {
  const stage = getIntegrationStage(integration.stage);
  const available = integration.stage === "available";

  const body = (
    <>
      <span
        className={
          available
            ? "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-accent-700 text-white"
            : "flex h-[29px] w-[29px] flex-none items-center justify-center rounded-[8px] bg-neutral-800 text-neutral-400"
        }
      >
        <Icon name={integration.icon} size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="t-headline truncate">{integration.name}</span>
        <span className="t-footnote t-secondary line-clamp-1">{integration.description}</span>
      </span>
    </>
  );

  if (available) {
    return integration.href ? (
      <Link href={integration.href} className="oq-row">
        {body}
        <Icon name="caret-right" size={15} className="flex-none text-neutral-600" />
      </Link>
    ) : (
      // No chevron and no press, because there is nowhere to go — but the row
      // says where the thing is set up, so that reads as an answer rather than
      // as a row that ignored the tap.
      <div className="oq-row">
        {body}
        {integration.configuredIn && (
          <span className="t-footnote t-secondary flex-none">{integration.configuredIn}</span>
        )}
      </div>
    );
  }

  return (
    // The stage word is short enough to be ambiguous on its own; `title` keeps
    // the sentence that explains it one hover away on a desktop, and costs a
    // phone nothing. It is what the four-badge legend above the grid used to be.
    <ToastButton
      title={stage.meaning}
      message={`${integration.name} tayyor bo'lganda xabar beramiz`}
      className="oq-row cursor-pointer"
    >
      {body}
      <Badge tone={stage.tone}>{stage.label}</Badge>
    </ToastButton>
  );
}

export default function IntegrationsPage() {
  const available = INTEGRATIONS.filter((integration) => integration.stage === "available");
  const upcoming = INTEGRATIONS.filter((integration) => integration.stage !== "available");

  return (
    <>
      <PageHeader title="Integratsiyalar" />
      <PageBody maxWidth={640}>
        <div className="flex flex-col gap-6">
          <ListGroup title={`Ishlaydi (${available.length})`} inset="icon">
            {available.map((integration) => (
              <IntegrationRow key={integration.name} integration={integration} />
            ))}
          </ListGroup>

          {/* The one sentence left on this screen, and it is the only thing that
              makes the rows below it worth tapping. What it replaced: a legend
              of four badges with a definition beside each, plus a paragraph
              saying the same about the waiting list at three times the length. */}
          <ListGroup
            title={`Kelgusida (${upcoming.length})`}
            inset="icon"
            footer="Bosing — ishga tushganda xabar beramiz."
          >
            {upcoming.map((integration) => (
              <IntegrationRow key={integration.name} integration={integration} />
            ))}
          </ListGroup>
        </div>
      </PageBody>
    </>
  );
}
