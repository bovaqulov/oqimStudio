"use client";

import { useTransition } from "react";
import { showToast } from "@/components/ui/toast-store";
import { confirmDestructive } from "@/lib/telegram/MainButton";
import { hapticResult } from "@/lib/telegram/webapp";
import { deleteProjectAction } from "../actions";

/**
 * Deleting a project, asked about by the client and carried out without a form.
 *
 * The same shape `DeleteFlowButton` uses, and for the same reason: Telegram's
 * confirmation is asynchronous, so nothing in the document may need to still
 * exist by the time the answer comes back. The `FormData` is built here.
 *
 * The refusal for a project that still holds bots or flows is not checked on
 * this side. Counting them here would mean a number fetched a render ago
 * deciding whether a button is allowed to work — the backend counts them
 * inside the delete, and its sentence is what the toast shows.
 */
export function DeleteProjectButton({ project }: { project: { id: string; name: string } }) {
  const [pending, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDestructive({
      title: project.name,
      message: "Loyiha o'chiriladi. Buni orqaga qaytarib bo'lmaydi.",
      confirmText: "O'chirish",
    });
    if (!ok) return;

    hapticResult("warning");
    startTransition(async () => {
      const data = new FormData();
      data.set("projectId", project.id);
      try {
        const result = await deleteProjectAction(data);
        if (result?.error) showToast(`${project.name} · ${result.error}`, { tone: "danger" });
      } catch (error) {
        // A redirect is thrown, not returned — that one is the success path and
        // belongs to the framework.
        if (isRedirect(error)) throw error;
        showToast(`${project.name} · o'chirib bo'lmadi`, { tone: "danger" });
      }
    });
  }

  return (
    <button type="button" disabled={pending} onClick={remove} className="oq-row cursor-pointer">
      <span className="t-body min-w-0 flex-1 truncate text-left text-danger-fg">
        {pending ? "O'chirilmoqda…" : "Loyihani o'chirish"}
      </span>
    </button>
  );
}

/** Next signals a server-side redirect by throwing; it must not be swallowed. */
function isRedirect(error: unknown): boolean {
  return (
    typeof (error as { digest?: unknown } | null)?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}
