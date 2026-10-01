"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { showToast } from "@/components/ui/toast-store";
import type { ModuleKey } from "@/features/flows";
import { parseFlowJson } from "@/features/flows/import-json";
import { importFlowAction, validateFlowImportAction } from "@/features/flows/transfer-actions";
import {
  FLOW_IMPORT_INITIAL_STATE,
  type ImportFinding,
  type ImportValidation,
} from "@/features/flows/transfer-types";
import { hapticResult } from "@/lib/telegram/webapp";
import { countOf } from "@/lib/utils/format";
import { AVAILABLE_MODULES, DEFAULT_MODULE_KEY, toAvailableModuleKey } from "../../modules";

const PLACEHOLDER = `{
  "nodes": [{ "id": "s1", "type": "start" }],
  "edges": []
}`;

/** What the name field falls back to, so no flow can be created called nothing. */
const FALLBACK_NAME = "Import qilingan oqim";

/**
 * Every byte of this ends up inside one server action call, and Next caps a
 * request body at a megabyte by default. Refusing at half of that with a
 * sentence beats a 413 the reader has no way to read.
 */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * One finding, led by the block it is about.
 *
 * The id is printed first and in mono because it is the only actionable half:
 * "«s1» blokida chiqish nomi noto'g'ri" tells the author which of forty
 * objects to open, and the same sentence without it tells them to re-read the
 * file. The colour comes from the group this sits in, so severity is carried
 * by where a row is and not only by how it looks.
 */
function FindingRow({ finding }: { finding: ImportFinding }) {
  // A dangling connection belongs to no block, so the edge's own id stands in.
  // Printing neither would leave the author with a sentence about a graph.
  const at = finding.nodeId || finding.edgeId;
  return (
    <li className="t-footnote flex gap-1.5 leading-[18px]">
      {at && <span className="flex-none font-mono opacity-75">«{at}»</span>}
      <span className="min-w-0">{finding.message}</span>
    </li>
  );
}

/**
 * A graph written somewhere else, turned into a flow here.
 *
 * The order is the whole design: parse, validate, *describe*, and only then a
 * button that creates something. An import that creates blocks the reader has
 * never seen described is a surprise, and this one arrives from a machine —
 * nobody has read the forty objects in it, so the count per block type and the
 * name it will be filed under are the only chance to notice that the thing
 * about to be created is not the thing that was asked for.
 *
 * Nothing here can overwrite a flow. It is said above the box rather than in a
 * footnote, because somebody uploading a corrected version expecting it to
 * replace what is live ends up with two flows answering the same command.
 *
 * The JSON is parsed in the browser first. "Bu JSON emas" needs no server to
 * say, and spending a round trip on it would be spending it to repeat what the
 * text already shows.
 */
export function FlowImportPanel({
  botId,
  projectId,
  canEdit,
  typeLabels,
}: {
  botId: string;
  projectId: string;
  canEdit: boolean;
  /**
   * Block type to its name, out of the same schema the copy button hands to
   * the other model. Empty when the schema could not be read — the preview
   * then prints the raw type, which is what the file says anyway.
   */
  typeLabels: Record<string, string>;
}) {
  const [state, formAction, importing] = useActionState(importFlowAction, FLOW_IMPORT_INITIAL_STATE);
  const [text, setText] = useState("");
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  /** How many characters of script the checked file carries. Zero for none. */
  const [scriptSize, setScriptSize] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState(FALLBACK_NAME);
  const [moduleKey, setModuleKey] = useState<ModuleKey>(DEFAULT_MODULE_KEY);
  const [checking, startCheck] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status !== "error" || !state.message) return;
    hapticResult("error");
    // In the toast as well as under the button: the panel does not move when an
    // import is refused, so without a word from somewhere it reads as a button
    // that did nothing.
    showToast(state.message, { tone: "danger" });
  }, [state]);

  /**
   * Text changed, so the preview under it no longer describes it — and the
   * button under *that* creates a flow. Dropping both is the only safe answer.
   */
  function applyText(next: string) {
    setText(next);
    setValidation(null);
    setProblem(null);
    setScriptSize(0);
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared before anything else, so picking the same filename twice fires a
    // second change event — the reader who fixed the file on disk and picked it
    // again would otherwise get no response at all.
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setProblem(`Fayl juda katta — ${Math.round(MAX_FILE_BYTES / 1024)} KB gacha JSON qabul qilinadi.`);
      return;
    }
    applyText(await file.text());
  }

  function check() {
    const parsed = parseFlowJson(text);
    if (!parsed.ok) {
      setValidation(null);
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    startCheck(async () => {
      const answer = await validateFlowImportAction(parsed.value.graph);
      if (answer.status === "error") {
        setValidation(null);
        setProblem(answer.message);
        showToast(answer.message, { tone: "danger" });
        return;
      }
      setValidation(answer.validation);
      // Re-read from the file on every check and not only the first: a second
      // check is a second file, and a name left over from the first one would
      // be filed against blocks it has nothing to do with.
      setName(parsed.value.name || FALLBACK_NAME);
      setModuleKey(toAvailableModuleKey(parsed.value.moduleKey));
      // The code the file carries, counted on the client — the backend's
      // summary describes the graph, and a flow's script is the one part of an
      // import that is invisible on the canvas afterwards. Without this a file
      // holding a hundred lines of hooks previews exactly like a file holding
      // none, and the reader finds out by opening the Script panel later, if
      // they think to.
      setScriptSize(parsed.value.script.length);
    });
  }

  if (!canEdit) {
    return (
      <p className="t-footnote t-tertiary m-0 px-1 leading-[18px]">
        JSON dan oqim import qilish uchun muharrir huquqi kerak. Eksport va bloklar lug&apos;ati quyida ochiq.
      </p>
    );
  }

  const findings = validation?.findings ?? [];
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  // Both conditions, because they are two answers to one question: a backend
  // that ever disagrees with itself about this must fail closed.
  const canImport = Boolean(validation?.ok) && errors.length === 0;
  const knownTypes = Object.keys(typeLabels).length > 0;
  const typeCounts = Object.entries(validation?.summary.types ?? {}).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="botId" value={botId} />
      <input type="hidden" name="projectId" value={projectId} />

      <p className="t-footnote t-tertiary m-0 px-1 leading-[18px]">
        Boshqa AI da yozilgan grafikni shu yerga qo&apos;ying yoki <code className="font-mono">.json</code> fayl
        tanlang. <span className="text-text">Import har doim yangi oqim yaratadi</span> — mavjud oqimlar
        o&apos;zgarmaydi va almashtirilmaydi.
      </p>

      <Textarea
        name="graph"
        value={text}
        rows={8}
        // The same four the code editors turn off: a curly quote or a
        // capitalised key is JSON that will not parse, and nothing says why.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-label="Oqim grafigi JSON"
        placeholder={PLACEHOLDER}
        className="font-mono text-[12.5px] leading-relaxed max-md:text-[15px]"
        onChange={(event) => applyText(event.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2 px-1">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          tabIndex={-1}
          onChange={pickFile}
        />
        <Button type="button" onClick={() => fileRef.current?.click()}>
          <Icon name="upload-simple" size={16} /> Fayl tanlash
        </Button>
        <Button type="button" onClick={check} disabled={checking || text.trim() === ""}>
          {checking ? "Tekshirilmoqda…" : "Tekshirish"}
        </Button>
        {text.trim() !== "" && !validation && !checking && (
          <span className="t-footnote t-tertiary">Avval tekshiruvdan o&apos;tkazing</span>
        )}
      </div>

      {problem && (
        <p role="alert" className="t-footnote m-0 px-1 leading-[18px] text-danger-fg">
          {problem}
        </p>
      )}

      {validation && (
        <Panel className="flex flex-col gap-3 p-3.5">
          <h3 className="t-subhead m-0">Nima yaratiladi</h3>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="t-footnote t-secondary">
              Bloklar: <span className="text-text tabular-nums">{countOf(validation.summary.nodes)}</span>
            </span>
            <span className="t-footnote t-secondary">
              Ulanishlar: <span className="text-text tabular-nums">{countOf(validation.summary.edges)}</span>
            </span>
            {scriptSize > 0 && (
              <span className="t-footnote t-secondary">
                Kod: <span className="text-text tabular-nums">{scriptSize}</span> belgi — oqim skripti ham yaratiladi
              </span>
            )}
          </div>

          {typeCounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {typeCounts.map(([type, count]) => (
                // Tinted when this build has no such block: the validator says
                // so too, but a count the author can see is unknown belongs
                // beside the other counts rather than only in the error list.
                <Badge key={type} tone={knownTypes && !typeLabels[type] ? "warning" : "neutral"}>
                  {`${typeLabels[type] ?? type} · ${count}`}
                </Badge>
              ))}
            </div>
          )}

          <Field label="Oqim nomi">
            <Input name="name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Field>

          <Field label="Bo'lim">
            <Select
              name="moduleKey"
              value={moduleKey}
              onChange={(event) => setModuleKey(event.target.value as ModuleKey)}
            >
              {AVAILABLE_MODULES.map((module) => (
                <option key={module.key} value={module.key}>
                  {module.name}
                </option>
              ))}
            </Select>
          </Field>

          {errors.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-danger-bg p-3 text-danger-fg">
              <p className="t-footnote m-0 font-medium">Xatolar · {errors.length} — import to&apos;xtaydi</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {errors.map((finding, index) => (
                  <FindingRow key={`${index}:${finding.code}`} finding={finding} />
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            // Its own box, its own colour and its own sentence. Warnings styled
            // like errors are warnings nobody imports past; warnings styled like
            // nothing are warnings nobody reads.
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-warning-bg p-3 text-warning-fg">
              <p className="t-footnote m-0 font-medium">
                Ogohlantirishlar · {warnings.length} — import davom etaveradi
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {warnings.map((finding, index) => (
                  <FindingRow key={`${index}:${finding.code}`} finding={finding} />
                ))}
              </ul>
            </div>
          )}

          {findings.length === 0 &&
            (validation.ok ? (
              <p className="t-footnote m-0 flex items-center gap-1.5 text-success-fg">
                <Icon name="check-circle" size={15} /> Tekshiruv toza — xato topilmadi.
              </p>
            ) : (
              // A refusal with nothing in the list. Nothing should produce it,
              // which is exactly why it is printed: silently drawing "toza"
              // over a disabled button is a screen contradicting itself.
              <p className="t-footnote m-0 flex items-center gap-1.5 text-danger-fg">
                <Icon name="warning" size={15} /> Tekshiruvdan o&apos;tmadi, sabab ko&apos;rsatilmadi.
              </p>
            ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canImport || importing}>
              {importing ? "Yaratilmoqda…" : "Yangi oqim yaratish"}
            </Button>
            <span className="t-footnote t-tertiary">
              {canImport ? "Yaratilgach oqim muharririga o'tasiz" : "Avval xatolarni to'g'rilang"}
            </span>
          </div>

          {state.status === "error" && (
            // Under the button as well as in the toast: the toast is gone in six
            // seconds, and the reason an import was refused is what the next
            // attempt has to be built on.
            <p role="alert" className="t-footnote m-0 text-danger-fg">
              {state.message}
            </p>
          )}
        </Panel>
      )}
    </form>
  );
}
