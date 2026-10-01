import { ListGroup, ListRow } from "@/components/ui/List";
import type { Project } from "../types";
import { DeleteProjectButton } from "./DeleteProjectButton";
import { EditProjectButton } from "./EditProjectButton";

/**
 * A project's settings, as iOS Settings.
 *
 * What this replaces: a two-column layout of 170px labels beside their values,
 * and under "Loyihani o'chirish" two grey sentences explaining why the button
 * would refuse ("move the bots first", "the main project cannot be deleted").
 * Both are gone — a rule the reader only meets when they press the button
 * belongs in the answer to the press, which is where it now is.
 *
 * Still a server component: the two things that need a client brought their own
 * — `DeleteProjectButton` and `EditProjectButton`. "Tahrirlash" was a toast
 * saying "sozlamalar" until a QA pass pointed out that a project could
 * therefore never be renamed; it now opens the edit sheet.
 */
export function ProjectSettingsPanel({ project }: { project: Project }) {
  return (
    <div className="flex flex-col gap-6">
      <ListGroup title="Loyiha">
        <ListRow label="Nomi" value={project.name} />
        {/* Only rows that have something to say: an empty "Tavsif" is a
            question the screen asks the reader instead of answering.

            Stacked rather than a label/value pair, because a description is a
            sentence and the value slot is one truncating line at 52% of the
            row. "Klinika uchun qabulga yozilish oqim…" is not a description,
            and there was nowhere to read the rest of it — no tooltip, no
            expand, and at the time no edit sheet either. */}
        {project.description && (
          <ListRow className="!items-start">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
              <span className="t-footnote t-secondary">Tavsif</span>
              <span className="t-body text-text whitespace-pre-line">{project.description}</span>
            </span>
          </ListRow>
        )}
        {project.tag && <ListRow label="Belgi" value={project.tag} />}
        {project.createdAt && <ListRow label="Yaratilgan" value={project.createdAt} />}
        {project.createdBy && <ListRow label="Yaratuvchi" value={project.createdBy} />}
        <EditProjectButton
          project={{ id: project.id, name: project.name, description: project.description }}
        />
      </ListGroup>

      {/* Red text on a row of its own, at the bottom — never a filled button.
          Why a delete would be refused is a rule the reader meets in the answer
          to the press, not in a sentence under the button that was printed
          whether it applied or not. */}
      <ListGroup>
        <DeleteProjectButton project={{ id: project.id, name: project.name }} />
      </ListGroup>
    </div>
  );
}
