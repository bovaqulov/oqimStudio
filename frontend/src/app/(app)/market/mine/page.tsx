import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { MyTemplateGroup } from "@/features/marketplace/components/MyTemplateGroup";
import { templatesRepository } from "@/features/marketplace/data/templates-repository";
import { getSession } from "@/features/workspace/session";

export default async function MyTemplatesPage() {
  const { workspace } = await getSession();
  const templates = await templatesRepository.listMine(workspace.id);

  if (templates.length === 0) {
    return (
      <Panel>
        {/* The description exists to answer the question this screen was being
            opened with. "Meniki" read as "the templates I installed", so a
            reader who had just installed one came here to look for it and was
            told they had never published anything — an answer to a question
            they had not asked, about a word that means the other thing. */}
        <EmptyState
          icon="pen-nib"
          title="Hali shablon nashr qilmagansiz"
          description="Bu yerda siz marketga chiqargan shablonlar turadi. O'rnatgan shablonlaringiz esa oqimga aylanadi — ularni bot ichidagi oqimlar ro'yxatidan topasiz."
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {templates.map((template) => (
        <MyTemplateGroup key={template.id} template={template} />
      ))}
    </div>
  );
}
