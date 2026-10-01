import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { NewProjectForm } from "@/features/projects/components/NewProjectForm";

export default function NewProjectPage() {
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Loyihalar", href: "/projects" }, { label: "Yangi loyiha" }]} title="Yangi loyiha" />
      <PageBody maxWidth={640}>
        <Panel className="p-4">
          <NewProjectForm />
        </Panel>
      </PageBody>
    </>
  );
}
