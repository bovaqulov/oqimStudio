"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canEditContent } from "@/features/workspace";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";
import { tablesRepository } from "./data/tables-repository";
import { duplicateKey, handleError } from "./handle";
import { isColumnType, type CellValue, type TableColumn, type TableKind } from "./types";

/**
 * Everything that writes a table.
 *
 * Nothing on any of these screens writes during a render — a prefetch, a
 * development double render and a refresh each run that again, and on
 * "qatorni qo'shish" that is three identical rows in a price list. Every write
 * below is reached from a button or a form action, and the check in
 * `scripts/check-render-effects.mjs` is what keeps it that way.
 *
 * The validation here is not a copy of the screen's — it is the rule. A server
 * action is a public endpoint: the disabled Save button is a courtesy, this is
 * what a hand-written POST meets. It is deliberately worded the same as the
 * client's refusal, though, so a reader cannot be told two different stories
 * about the same handle.
 */

/** Longest name the list row and the breadcrumb can carry — the backend's column is 120. */
const MAX_NAME = 120;
/** Longest column heading that still fits a table cell rather than wrapping it into a paragraph. */
const MAX_LABEL = 60;
/** The backend's ceiling on a `select` column's choices — `tables/services.py::MAX_OPTIONS`. */
const MAX_OPTIONS = 100;
/** The backend truncates a formula here; saying so before the round trip keeps the two agreeing. */
const MAX_FORMULA = 500;

type Refusal = { error: string; field?: "name" | "handle" | "columns" };

/** What a save answers with: nothing at all, or one sentence and the field it belongs under. */
type SaveResult = { error?: string; field?: "name" | "handle" | "columns" };

async function requireEditor(): Promise<{ workspaceId: string } | { error: string }> {
  const session = await getSession();
  if (!canEditContent(session.role)) {
    return { error: "Ma'lumotni o'zgartirish uchun tahrirlash huquqi kerak — hozirgi rolingiz faqat ko'radi." };
  }
  return { workspaceId: session.workspace.id };
}

/** The API's own sentence when it has one, and a readable fallback when the failure was not an answer. */
function reason(error: unknown, fallback: string): Refusal {
  if (error instanceof ApiError) {
    const field = error.field === "name" || error.field === "handle" ? error.field : undefined;
    return { error: error.message, ...(field ? { field } : {}) };
  }
  console.error(fallback, error);
  return { error: fallback };
}

/**
 * A `select` column's choices, tidied the way the backend tidies them.
 *
 * Blanks and repeats are dropped rather than refused, because the editor is a
 * textarea with one option per line and a trailing newline is somebody pressing
 * Enter. Anything that is not a list of strings becomes no list at all — a
 * column with no choices yet accepts any value, which is the state the editor
 * starts every `select` column in.
 */
function cleanOptions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const options: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const text = String(item).trim().slice(0, 120);
    if (!text || options.includes(text)) continue;
    options.push(text);
  }
  return options.slice(0, MAX_OPTIONS);
}

/**
 * Columns as they may be stored, or the sentence saying why not.
 *
 * Whatever arrives is treated as untrusted: a fifth type, a key with a capital
 * in it and a column with no key at all are all things a hand-written request
 * can carry, and all three would be stored by a backend that trusted this
 * client.
 *
 * **Everything the type carries travels with it.** This used to rebuild each
 * column as `{key, label, type}` and nothing else, which threw away the one
 * field that makes three of the seven types mean anything: a `select` lost its
 * `options`, a `formula` lost its `formula` and a `ref` lost the table it
 * pointed at — on the create *and* on every save afterwards. The type was
 * stored, so the studio drew the right editor and the right dropdown, and the
 * dropdown was empty; nothing anywhere said why. A column is a type plus what
 * that type needs, and dropping the second half is dropping the column.
 */
function cleanColumns(input: unknown): TableColumn[] | Refusal {
  if (!Array.isArray(input)) return { error: "Ustunlar o'qilmadi.", field: "columns" };

  const columns: TableColumn[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      key?: unknown;
      label?: unknown;
      type?: unknown;
      options?: unknown;
      refTable?: unknown;
      refColumn?: unknown;
      formula?: unknown;
    };
    const key = String(item.key ?? "").trim();
    const label = String(item.label ?? "").trim().slice(0, MAX_LABEL);
    const type = String(item.type ?? "text");

    const wrong = handleError(key, "Ustun kaliti");
    if (wrong) return { error: wrong, field: "columns" };
    if (!isColumnType(type)) return { error: `«${key}» ustunining turi noma'lum.`, field: "columns" };

    // A label nobody typed falls back to the key rather than to an empty
    // heading: a column with a blank header is a column the reader cannot name
    // when something goes wrong in it.
    //
    // The keys go out in the order the serializer emits them, because the
    // columns editor decides whether anything is still unsaved by comparing the
    // two as JSON — the same fields in a different order would leave its Save
    // button standing after a save that worked.
    if (type === "select") {
      columns.push({ key, label: label || key, type, options: cleanOptions(item.options) });
    } else if (type === "ref") {
      // Both halves may be empty. The type is chosen first and pointed
      // somewhere second, and refusing the save in between traps the author on
      // a screen they cannot leave — the backend allows the same gap.
      columns.push({
        key,
        label: label || key,
        type,
        refTable: String(item.refTable ?? "").trim().toLowerCase(),
        refColumn: String(item.refColumn ?? "").trim().toLowerCase(),
      });
    } else if (type === "formula") {
      // Blank is allowed for the same reason, and computes nothing until it
      // is written.
      const formula = String(item.formula ?? "").trim().slice(0, MAX_FORMULA);
      columns.push({ key, label: label || key, type, formula });
    } else {
      columns.push({ key, label: label || key, type });
    }
  }

  if (columns.length === 0) {
    return { error: "Kamida bitta ustun kerak — ma'lumot nimadan iboratligini ustunlar aytadi.", field: "columns" };
  }
  const repeated = duplicateKey(columns.map((column) => column.key));
  if (repeated) return { error: `«${repeated}» kaliti ikki marta ishlatilgan.`, field: "columns" };
  return columns;
}

function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && "error" in value;
}

/** Cells, narrowed to what JSON can carry. Anything else is a value nobody typed. */
function cleanData(input: Record<string, unknown>): Record<string, CellValue> {
  const data: Record<string, CellValue> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      data[key] = value;
    }
  }
  return data;
}

/** The two places a table's name and columns are read from. */
function revalidateTable(tableId: string): void {
  revalidatePath("/tables");
  // "layout" because the name stands in the header and the tab strip above
  // every one of the table's three screens, not only on the one that changed it.
  revalidatePath(`/tables/${tableId}`, "layout");
}

/**
 * Creates a table and hands back its id, so the caller can go there.
 *
 * The id is returned rather than redirected to from here: the form that calls
 * this is a client component holding the columns the reader just described, and
 * a `redirect` thrown mid-transition would unmount it before a refusal could be
 * shown beside the field it belongs to.
 */
export async function createTableAction(input: {
  name: string;
  botId: string | null;
  /** The project this belongs to, when it was created from one. */
  projectId?: string | null;
  /** `table` unless the wizard was told otherwise. A `kv` store ignores `columns`. */
  kind?: TableKind;
  columns: unknown;
}): Promise<{ tableId: string } | Refusal> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;

  const name = String(input.name ?? "").trim();
  if (!name) return { error: "Ma'lumotga nom bering.", field: "name" };
  if (name.length > MAX_NAME) return { error: `Nom juda uzun — ${MAX_NAME} belgidan oshmasin.`, field: "name" };

  // A `kv` store's columns are the kind, not a choice, and the backend
  // replaces whatever arrives with the pair. Sending an empty list rather than
  // running it through `cleanColumns` keeps this from refusing a create for
  // the absence of something the store is not allowed to have.
  const kind: TableKind = input.kind === "kv" ? "kv" : "table";
  const columns = kind === "kv" ? [] : cleanColumns(input.columns);
  if (isRefusal(columns)) return columns;

  try {
    const table = await tablesRepository.create({
      workspaceId: gate.workspaceId,
      name,
      // Blank, so the backend derives one from the name and guarantees it is
      // free in this workspace — `tables/serializers.py::derive_handle`. Asking
      // for it was asking somebody who came to write down their prices to name
      // a database key.
      handle: "",
      kind,
      botId: input.botId || null,
      projectId: input.projectId || null,
      columns,
    });
    revalidatePath("/tables");
    // The project's own «Resurslar» tab lists these, and it is the screen the
    // reader is sent back to when they got here from one.
    if (input.projectId) revalidatePath(`/projects/${input.projectId}`);
    return { tableId: table.id };
  } catch (error) {
    return reason(error, "Ma'lumot yaratilmadi. Birozdan so'ng urinib ko'ring.");
  }
}

/** Renames a table, or moves it to another bot. Columns are saved separately — see below. */
export async function updateTableAction(input: {
  tableId: string;
  name: string;
  botId: string | null;
  /** Null files it under no project — which is a state, not a refusal. */
  projectId?: string | null;
  /**
   * Where it was filed before, so both project pages can be revalidated. The
   * form knows; this action would have to re-read the table to find out, and a
   * move that refreshed only its destination leaves the table still listed on
   * the project it just left.
   */
  wasProjectId?: string | null;
}): Promise<SaveResult> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId) return { error: "Ma'lumot topilmadi." };

  const name = String(input.name ?? "").trim();
  if (!name) return { error: "Ma'lumotga nom bering.", field: "name" };
  if (name.length > MAX_NAME) return { error: `Nom juda uzun — ${MAX_NAME} belgidan oshmasin.`, field: "name" };

  try {
    // The key is not sent, and a PATCH that omits it leaves it alone. It is
    // derived once, when the table is made, and nothing renames it afterwards —
    // `TableSettingsForm` says why offering that rename was the bug.
    await tablesRepository.update(gate.workspaceId, input.tableId, {
      name,
      botId: input.botId || null,
      projectId: input.projectId || null,
    });
  } catch (error) {
    return reason(error, "Saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.");
  }
  revalidateTable(input.tableId);
  // Both ends of a move. A `Set` because the ordinary save is not a move at
  // all and the two ids are the same one.
  for (const projectId of new Set([input.projectId, input.wasProjectId])) {
    if (projectId) revalidatePath(`/projects/${projectId}`);
  }
  return {};
}

/**
 * Saves the column list.
 *
 * Its own action rather than part of the settings save, because it is its own
 * screen and its own kind of change: renaming a table is cosmetic, while
 * renaming a column key changes the name every flow expression and every
 * incoming webhook has to use. The editor says so above the Save button.
 */
export async function saveColumnsAction(input: {
  tableId: string;
  columns: unknown;
}): Promise<SaveResult> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId) return { error: "Ma'lumot topilmadi." };

  const columns = cleanColumns(input.columns);
  if (isRefusal(columns)) return columns;

  try {
    await tablesRepository.update(gate.workspaceId, input.tableId, { columns });
  } catch (error) {
    return reason(error, "Ustunlarni saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.");
  }
  revalidateTable(input.tableId);
  return {};
}

/**
 * Deletes the table and everything in it.
 *
 * The rows go with it — the backend cascades — so the confirmation the button
 * asks says how many, and it is the only warning there is.
 */
export async function deleteTableAction(input: { tableId: string }): Promise<{ error: string } | void> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId) return { error: "Ma'lumot topilmadi." };

  try {
    await tablesRepository.delete(gate.workspaceId, input.tableId);
  } catch (error) {
    const refusal = reason(error, "Ma'lumotni o'chirib bo'lmadi. Birozdan so'ng urinib ko'ring.");
    return { error: refusal.error };
  }
  revalidatePath("/tables");
  redirect("/tables");
}

/**
 * What a row save answers with, and which column the sentence belongs under.
 *
 * `column` is the backend's own `field` when it named one — `«manzil» kaliti
 * allaqachon bor` arrives with `field: "kalit"`, and `«Narx» ustuniga son
 * kiritilishi kerak` with the key of the column it means. Without it the sheet
 * has no choice but to print every refusal at the bottom of the form, under
 * whichever field happens to be last: the duplicate-key message was reported as
 * appearing under «Qiymat», which is simply the field it landed beneath.
 */
type RowResult = { error?: string; column?: string };

/** The API's sentence and the column it belongs to, or a readable fallback. */
function rowReason(error: unknown, fallback: string): RowResult {
  if (error instanceof ApiError) {
    return { error: error.message, ...(error.field ? { column: error.field } : {}) };
  }
  console.error(fallback, error);
  return { error: fallback };
}

/** Adds one row. The keys are the table's column keys; anything else the backend drops. */
export async function createRowAction(input: {
  tableId: string;
  data: Record<string, unknown>;
}): Promise<RowResult> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId) return { error: "Ma'lumot topilmadi." };

  try {
    await tablesRepository.createRow(gate.workspaceId, input.tableId, cleanData(input.data));
  } catch (error) {
    return rowReason(error, "Qator qo'shilmadi. Birozdan so'ng urinib ko'ring.");
  }
  revalidateTable(input.tableId);
  return {};
}

/** Rewrites one row. The whole `data` object is sent, so a cleared cell is really cleared. */
export async function updateRowAction(input: {
  tableId: string;
  rowId: string;
  data: Record<string, unknown>;
}): Promise<RowResult> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId || !input.rowId) return { error: "Qator topilmadi." };

  try {
    await tablesRepository.updateRow(gate.workspaceId, input.tableId, input.rowId, cleanData(input.data));
  } catch (error) {
    return rowReason(error, "Qatorni saqlab bo'lmadi. Birozdan so'ng urinib ko'ring.");
  }
  revalidateTable(input.tableId);
  return {};
}

/** Removes one row. Asked about by its first cell, from the sheet that is showing it. */
export async function deleteRowAction(input: { tableId: string; rowId: string }): Promise<{ error?: string }> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId || !input.rowId) return { error: "Qator topilmadi." };

  try {
    await tablesRepository.deleteRow(gate.workspaceId, input.tableId, input.rowId);
  } catch (error) {
    return { error: reason(error, "Qatorni o'chirib bo'lmadi. Birozdan so'ng urinib ko'ring.").error };
  }
  revalidateTable(input.tableId);
  return {};
}

/**
 * Appends the rows in an uploaded spreadsheet.
 *
 * `FormData` in and a sentence out, because a file cannot be passed to a server
 * action any other way — and because the file never touches this process's
 * memory as anything but a handle: it is forwarded to the backend, which is
 * where `clean_row_data` already decides what a column accepts.
 *
 * The backend refuses the whole file when any row in it is wrong, and its
 * refusal names the line numbers. That sentence is passed through verbatim
 * rather than replaced with "import failed": "3-qator: «Narx» ustuniga son
 * kiritilishi kerak" is the difference between a reader who fixes their file
 * and a reader who tries the same upload again.
 */
export async function importRowsAction(
  formData: FormData,
): Promise<{ added?: number; error?: string }> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;

  const tableId = String(formData.get("tableId") ?? "");
  if (!tableId) return { error: "Ma'lumot topilmadi." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Fayl tanlanmadi." };
  }

  try {
    const report = await tablesRepository.importRows(gate.workspaceId, tableId, file);
    revalidateTable(tableId);
    return { added: report.added };
  } catch (error) {
    return { error: reason(error, "Faylni yuklab bo'lmadi. Birozdan so'ng urinib ko'ring.").error };
  }
}

/**
 * A new webhook secret, and therefore a new URL.
 *
 * Whatever was posting into the old one stops the moment this returns, which is
 * the entire purpose of the button and also the reason it asks first. The new
 * address arrives with the revalidated page rather than in this result: it is
 * shown in one place, and two copies of a URL are two things that can disagree.
 */
export async function rotateSecretAction(input: { tableId: string }): Promise<{ error?: string }> {
  const gate = await requireEditor();
  if ("error" in gate) return gate;
  if (!input.tableId) return { error: "Ma'lumot topilmadi." };

  try {
    await tablesRepository.rotateSecret(gate.workspaceId, input.tableId);
  } catch (error) {
    return { error: reason(error, "Yangi sir olinmadi. Birozdan so'ng urinib ko'ring.").error };
  }
  revalidateTable(input.tableId);
  return {};
}
