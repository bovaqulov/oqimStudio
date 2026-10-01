import { ResourceGroupList } from "@/features/projects/components/ResourceGroupList";
import { getProjectResourceGroups } from "@/features/projects/get-resource-groups";
import { getSession } from "@/features/workspace/session";

export default async function ProjectResourcesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { workspace } = await getSession();
  const groups = await getProjectResourceGroups(workspace.id, projectId);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <ResourceGroupList key={group.title} group={group} />
      ))}
    </div>
  );
}
