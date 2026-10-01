"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { ModuleKey } from "@/features/flows";
import { cn } from "@/lib/utils/cn";
import { createFlowFromBlueprintAction } from "../actions";
import { buildGraphFromDrafts } from "../lib/build-graph";
import { defaultValues, missingInputs, withDefaults } from "../lib/inputs";
import { getModuleKit } from "../registry";
import type { ActionRecipe, BlueprintStep, RecipeValue, RecipeValues, TriggerRecipe } from "../types";
import { FlowChatPreview } from "./FlowChatPreview";
import { RecipeFields } from "./RecipeFields";

/**
 * The no-code builder: three questions, in the order a shop owner thinks about
 * them — *when* should the bot react, *what* should it do, and *is this right*.
 *
 * It is written against `ModuleKit` and knows nothing about which module it is
 * serving: the recipes, their questions and the graph they compile to all come
 * from the kit, so this same wizard is the one the `business`, `groups`,
 * `channels`, `dms` and `webapp` modules open.
 */

interface DraftAction {
  /** Stable across reorders, so React keeps each card's expanded state on the right one. */
  id: string;
  recipe: string;
  values: RecipeValues;
}

const STEPS = [
  { key: "when", label: "Qachon" },
  { key: "what", label: "Nima bo'ladi" },
  { key: "check", label: "Tekshirish" },
];

export function FlowWizard({
  moduleKey,
  projectId,
  botId,
  open,
  onClose,
  /** Opened from a gallery card's "Sozlash bilan ochish" — the template's own answers, pre-filled. */
  initial,
}: {
  moduleKey: ModuleKey;
  projectId: string;
  botId: string;
  open: boolean;
  onClose: () => void;
  initial?: { name?: string; templateKey?: string; trigger: BlueprintStep; actions: BlueprintStep[] };
}) {
  // Keyed on what it was opened with: a second visit starts clean rather than
  // resuming a half-filled draft the author has already navigated away from.
  if (!open) return null;
  return (
    <WizardSession
      key={initial?.templateKey ?? "blank"}
      moduleKey={moduleKey}
      projectId={projectId}
      botId={botId}
      onClose={onClose}
      initial={initial}
    />
  );
}

function WizardSession({
  moduleKey,
  projectId,
  botId,
  onClose,
  initial,
}: {
  moduleKey: ModuleKey;
  projectId: string;
  botId: string;
  onClose: () => void;
  initial?: { name?: string; templateKey?: string; trigger: BlueprintStep; actions: BlueprintStep[] };
}) {
  const kit = getModuleKit(moduleKey);
  const [step, setStep] = useState(0);
  const [triggerKey, setTriggerKey] = useState<string | null>(initial?.trigger.recipe ?? null);
  const [triggerValues, setTriggerValues] = useState<RecipeValues>(() => {
    const recipe = kit.triggers.find((item) => item.key === initial?.trigger.recipe);
    return recipe ? withDefaults(recipe.inputs, initial?.trigger.values) : {};
  });
  const [actions, setActions] = useState<DraftAction[]>(() =>
    (initial?.actions ?? []).flatMap((step, index) => {
      const recipe = kit.actions.find((item) => item.key === step.recipe);
      return recipe ? [{ id: `a${index}`, recipe: recipe.key, values: withDefaults(recipe.inputs, step.values) }] : [];
    }),
  );
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [showErrors, setShowErrors] = useState(false);
  /** What the server refused, kept beside the answers that caused it. */
  const [saveError, setSaveError] = useState<{ message: string; code?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const nextActionId = useRef(actions.length);

  const trigger = kit.triggers.find((item) => item.key === triggerKey) ?? null;
  const suggestedName = trigger?.label ?? "Yangi oqim";

  const triggerMissing = trigger ? missingInputs(trigger.inputs, triggerValues).map((input) => input.key) : [];
  const actionIssues = actions.filter((action) => {
    const recipe = kit.actions.find((item) => item.key === action.recipe);
    return recipe ? missingInputs(recipe.inputs, action.values).length > 0 : false;
  });

  /** Whether the step on screen has enough to move on from. The review step always does. */
  const stepValid =
    step === 0
      ? Boolean(trigger) && triggerMissing.length === 0
      : step === 1
        ? actions.length > 0 && actionIssues.length === 0
        : true;

  /** The graph as it stands — rebuilt on every keystroke, which is what makes the review step honest. */
  const graph = useMemo(() => {
    if (!trigger) return { nodes: [], edges: [] };
    const drafts = [
      ...trigger.build(triggerValues),
      ...actions.flatMap((action) => {
        const recipe = kit.actions.find((item) => item.key === action.recipe);
        return recipe ? recipe.build(action.values) : [];
      }),
    ];
    return buildGraphFromDrafts(drafts, moduleKey);
  }, [trigger, triggerValues, actions, kit, moduleKey]);

  const hasTerminal = actions.some(
    (action) => kit.actions.find((item) => item.key === action.recipe)?.terminal,
  );

  function pickTrigger(recipe: TriggerRecipe) {
    setTriggerKey(recipe.key);
    setTriggerValues(defaultValues(recipe.inputs));
    setShowErrors(false);
  }

  function addAction(recipe: ActionRecipe) {
    // A counter, not a timestamp: the id only has to be unique within this
    // session's list, and a render-time clock read is a different value every
    // time the component happens to re-render.
    nextActionId.current += 1;
    const id = `a${nextActionId.current}`;
    setActions((current) => [...current, { id, recipe: recipe.key, values: defaultValues(recipe.inputs) }]);
    setOpenAction(id);
    setPicking(false);
  }

  function setActionValue(id: string, key: string, value: RecipeValue) {
    setActions((current) =>
      current.map((action) => (action.id === id ? { ...action, values: { ...action.values, [key]: value } } : action)),
    );
  }

  function move(id: string, delta: number) {
    setActions((current) => {
      const index = current.findIndex((action) => action.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }

  function goNext() {
    if (!stepValid) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  /**
   * Saving, and what happens when the server says no.
   *
   * The sheet stays open and every answer stays in it. Three steps of work
   * disappearing into a full-page error boundary — which is what a thrown
   * `ApiError` used to cause — is the worst possible reading of "your plan
   * covers five flows": the reader cannot act on it *and* has lost what they
   * typed. A successful save never comes back here at all; the action
   * redirects into the new flow.
   */
  function save(enabled: boolean) {
    if (!trigger) return;
    setSaveError(null);
    startTransition(async () => {
      const failure = await createFlowFromBlueprintAction({
        projectId,
        botId,
        moduleKey,
        name: name.trim() || suggestedName,
        templateKey: initial?.templateKey,
        enabled,
        trigger: { recipe: trigger.key, values: triggerValues },
        actions: actions.map((action) => ({ recipe: action.recipe, values: action.values })),
      });
      if (failure) setSaveError({ message: failure.message, code: failure.code });
    });
  }

  return (
    <Modal open onClose={onClose} labelledBy="wizard-title" className="max-w-[900px]">
      {/* ------------------------------- Header ------------------------------ */}
      <div className="flex flex-none items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-800 text-accent-ink max-md:hidden">
          <Icon name="sparkle" size={14} />
        </span>
        {/* Back sits at the top on a phone: the strip at the bottom of the sheet
            is reserved for the one action that moves the wizard forward. */}
        {step > 0 && (
          <IconButton
            icon="arrow-left"
            label="Orqaga"
            size={38}
            className="-ml-1.5 md:hidden"
            onClick={() => setStep((current) => current - 1)}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span id="wizard-title" className="truncate text-[13.5px] font-medium max-md:text-[15px]">
            Yangi oqim — kod yozmasdan
          </span>
          <span className="truncate text-[11px] text-neutral-600 max-md:text-[13px]">
            {kit.eventNoun} · 3 qadamda tayyor bo&apos;ladi
          </span>
        </span>
        <IconButton icon="x" label="Yopish" size={26} className="max-md:h-[38px] max-md:w-[38px]" onClick={onClose} />
      </div>

      <StepBar step={step} onStep={(index) => index < step && setStep(index)} />

      {/* -------------------------------- Body ------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 0 && (
          <div className="flex flex-col gap-3">
            <StepHeading title={kit.triggerQuestion} />
            <div className="grid gap-2 md:grid-cols-2">
              {kit.triggers.map((recipe) => (
                <OptionCard
                  key={recipe.key}
                  icon={recipe.icon}
                  title={recipe.label}
                  description={recipe.description}
                  active={triggerKey === recipe.key}
                  onClick={() => pickTrigger(recipe)}
                />
              ))}
            </div>

            {trigger && trigger.inputs.length > 0 && (
              <div className="animate-rise mt-1 rounded-[16px] bg-surface-raised p-4">
                {/* Sentence case, and short. "BUYRUQ YOZILGANDA SOZLAMALARI"
                    was the trigger's whole label shouted back at the reader who
                    had just chosen it one row above. */}
                <div className="t-footnote t-secondary mb-3">Sozlamalar</div>
                <RecipeFields
                  inputs={trigger.inputs}
                  values={triggerValues}
                  onChange={(key, value) => setTriggerValues((current) => ({ ...current, [key]: value }))}
                  missing={showErrors ? triggerMissing : []}
                />
              </div>
            )}

            {trigger && (
              <SummaryLine icon="lightning" label="Shart" text={trigger.summary(triggerValues)} />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <StepHeading title={kit.actionQuestion} />

            {actions.length === 0 && !picking && (
              <div className="rounded-md border border-dashed border-neutral-800 px-4 py-6 text-center">
                <div className="text-[12.5px] text-neutral-400 max-md:text-[15px]">Hali birorta amal yo&apos;q</div>
                <div className="mx-auto mt-1 max-w-[320px] text-[11.5px] leading-relaxed text-neutral-600 max-md:text-[13px]">
                  Eng ko&apos;p ishlatiladigani — mijozga avtomatik javob yuborish.
                </div>
                <Button variant="primary" className="mt-3" onClick={() => setPicking(true)}>
                  <Icon name="plus" size={12} /> Birinchi amalni qo&apos;shish
                </Button>
              </div>
            )}

            {actions.map((action, index) => {
              const recipe = kit.actions.find((item) => item.key === action.recipe);
              if (!recipe) return null;
              const expanded = openAction === action.id;
              const missing = showErrors ? missingInputs(recipe.inputs, action.values).map((input) => input.key) : [];
              return (
                <div
                  key={action.id}
                  className={cn(
                    "overflow-hidden rounded-md border transition-colors",
                    missing.length ? "border-danger-fg/50" : expanded ? "border-accent-800" : "border-neutral-800",
                  )}
                >
                  <div className="flex items-center gap-2 bg-surface-raised px-2.5 py-2 max-md:gap-1 max-md:px-3 max-md:py-2.5">
                    <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neutral-800 text-[10.5px] text-neutral-400 tabular-nums">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenAction(expanded ? null : action.id)}
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    >
                      <Icon name={recipe.icon} size={13} className="flex-none text-accent-300" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[12.5px] text-neutral-100 max-md:text-[15px]">{recipe.label}</span>
                        <span className="truncate text-[11px] text-neutral-600 max-md:text-[13px]">
                          {recipe.summary(action.values)}
                        </span>
                      </span>
                    </button>
                    <IconButton
                      icon="caret-up"
                      label="Yuqoriga"
                      size={24}
                      disabled={index === 0}
                      onClick={() => move(action.id, -1)}
                    />
                    <IconButton
                      icon="caret-down"
                      label="Pastga"
                      size={24}
                      disabled={index === actions.length - 1}
                      onClick={() => move(action.id, 1)}
                    />
                    <IconButton
                      icon="trash"
                      label="Amalni olib tashlash"
                      size={24}
                      tone="danger"
                      onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))}
                    />
                  </div>
                  {expanded && (
                    <div className="animate-rise border-t border-neutral-800 p-3.5">
                      <RecipeFields
                        inputs={recipe.inputs}
                        values={action.values}
                        onChange={(key, value) => setActionValue(action.id, key, value)}
                        missing={missing}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {picking ? (
              <div className="animate-rise rounded-md border border-neutral-800 bg-surface-raised p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex-1 text-[11.5px] text-neutral-400 max-md:text-[15px]">Qanday amal qo&apos;shiladi?</span>
                  <IconButton icon="x" label="Bekor qilish" size={22} onClick={() => setPicking(false)} />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {kit.actions.map((recipe) => (
                    <OptionCard
                      key={recipe.key}
                      icon={recipe.icon}
                      title={recipe.label}
                      description={recipe.description}
                      active={false}
                      onClick={() => addAction(recipe)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              actions.length > 0 &&
              (hasTerminal ? (
                <div className="flex items-start gap-2 rounded-md bg-neutral-800/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-neutral-500">
                  <Icon name="info" size={13} className="mt-0.5 flex-none text-neutral-600" />
                  Operatorga uzatilgandan keyin oqim tugaydi — suhbatni jonli xodim davom ettiradi.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-800 py-2.5 text-[12px] text-neutral-500 transition-colors hover:border-accent-700 hover:text-accent-200 max-md:min-h-[48px] max-md:text-[15px]"
                >
                  <Icon name="plus" size={12} /> Yana bir amal qo&apos;shish
                </button>
              ))
            )}

            {showErrors && actions.length === 0 && (
              <div className="text-[11.5px] text-danger-fg">Kamida bitta amal qo&apos;shing.</div>
            )}
          </div>
        )}

        {step === 2 && trigger && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_302px]">
            <div className="flex min-w-0 flex-col gap-3.5">
              <StepHeading title="Oqim tayyor — nomini bering va tekshiring" />

              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-neutral-200 max-md:text-[13px]">Oqim nomi</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={suggestedName}
                  className="py-1.5 text-[12.5px]"
                />
              </label>

              <div className="flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-surface-raised p-3.5">
                <div className="t-footnote t-secondary">Oqim mantiqi</div>
                <div className="flex items-start gap-2">
                  <span className="mt-[3px] flex h-4 w-4 flex-none items-center justify-center rounded-full bg-warning-bg text-warning-fg">
                    <Icon name="lightning" size={9} />
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-neutral-200 max-md:text-[15px]">
                    {trigger.summary(triggerValues)}
                  </span>
                </div>
                {actions.map((action, index) => {
                  const recipe = kit.actions.find((item) => item.key === action.recipe);
                  if (!recipe) return null;
                  return (
                    <div key={action.id} className="flex items-start gap-2 pl-[7px]">
                      <span className="mt-[3px] flex h-4 w-4 flex-none items-center justify-center text-neutral-700">
                        <Icon name="arrow-elbow-down-right" size={11} />
                      </span>
                      <span className="text-[12px] leading-relaxed text-neutral-400">
                        <span className="text-neutral-600 tabular-nums">{index + 1}.</span> {recipe.summary(action.values)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-2 rounded-md border border-accent-900 bg-accent-950 px-3 py-2.5">
                <Icon name="info" size={13} className="mt-0.5 flex-none text-accent-300" />
                <span className="text-[11.5px] leading-relaxed text-neutral-400 max-md:text-[13px]">
                  Saqlagandan keyin oqim vizual muharrirda ochiladi — har bir blokni qo&apos;lda tahrirlashingiz,
                  yangi shart yoki tugma qo&apos;shishingiz mumkin.
                </span>
              </div>
            </div>

            <div className="flex min-h-[320px] flex-col gap-1.5 lg:min-h-0">
              <div className="t-footnote t-secondary">Mijoz nimani ko&apos;radi</div>
              <FlowChatPreview
                nodes={graph.nodes}
                edges={graph.edges}
                resetKey={String(graph.nodes.length)}
                className="min-h-[300px] flex-1"
              />
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------- Footer ------------------------------ */}
      {/* On a phone this strip is the thumb zone, so it carries the step's one
          forward action full-width and nothing else: the ways back are the
          header's arrow and the header's close, where they cannot be hit by
          mistake. */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-t border-neutral-800 px-4 py-3 max-md:flex-col max-md:items-stretch max-md:gap-2.5">
        {step > 0 ? (
          <Button
            variant="ghost"
            className="max-md:hidden"
            onClick={() => setStep((current) => current - 1)}
            disabled={pending}
          >
            <Icon name="arrow-left" size={12} /> Orqaga
          </Button>
        ) : (
          <Button variant="ghost" className="max-md:hidden" onClick={onClose}>
            Bekor qilish
          </Button>
        )}
        <span className="flex-1 max-md:hidden" />
        {step < STEPS.length - 1 ? (
          <>
            {!stepValid && showErrors && (
              <span className="t-footnote text-danger-fg max-md:text-center">
                Yuqoridagi maydonlarni to&apos;ldiring
              </span>
            )}
            {/* Clickable while incomplete on purpose: pressing it is how the
                author finds out *which* field is missing, which a greyed-out
                button can never tell them. */}
            <Button
              variant="primary"
              onClick={goNext}
              aria-disabled={!stepValid}
              className={cn("max-md:flex-1 max-md:justify-center", !stepValid && "opacity-60")}
            >
              Davom etish <Icon name="arrow-right" size={15} />
            </Button>
          </>
        ) : (
          <>
            {/* The server's own words, where the button that caused them is —
                not a toast that outlives the sheet, and not a page-level error
                that takes the answers with it. */}
            {saveError && (
              <span role="alert" className="t-footnote flex w-full flex-wrap items-center justify-center gap-x-2 text-danger-fg md:justify-start">
                {saveError.message}
                {/* The one refusal with somewhere to go. Every other failure is
                    "try again", and a link would be a dead end. */}
                {saveError.code === "plan_limit" && (
                  <Link href="/billing" className="text-accent-400 underline-offset-2 hover:underline">
                    Tariflar
                  </Link>
                )}
              </span>
            )}
            {/* Plain text beside the one fill: two filled buttons on a sheet
                make the reader choose between two things that look equally
                like the way forward. */}
            <Button variant="ghost" onClick={() => save(false)} disabled={pending}>
              Qoralama
            </Button>
            <Button
              variant="primary"
              className="max-md:flex-1 max-md:justify-center"
              onClick={() => save(true)}
              disabled={pending}
            >
              {pending ? "Saqlanmoqda…" : "Yaratish va yoqish"}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function StepBar({ step, onStep }: { step: number; onStep: (index: number) => void }) {
  return (
    <div className="flex flex-none items-center gap-1 border-b border-neutral-900 px-3 py-2">
      {STEPS.map((item, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onStep(index)}
            aria-current={active ? "step" : undefined}
            disabled={index > step}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors max-md:flex-1 max-md:justify-center max-md:py-2 max-md:text-[13px]",
              active
                ? "bg-accent-800 text-accent-ink"
                : done
                  ? "cursor-pointer text-accent-300 hover:bg-neutral-800"
                  : "text-neutral-700",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9.5px] tabular-nums",
                active ? "bg-white/20 text-white" : done ? "bg-accent-900 text-accent-200" : "bg-neutral-800 text-neutral-600",
              )}
            >
              {done ? <Icon name="check" size={8} weight="bold" /> : index + 1}
            </span>
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One line, and it is a question. Every one of these used to carry a second
 * grey line restating it — "Botni ishga tushiradigan holatni tanlang" under
 * "Bot qachon javob bersin?" is the same sentence twice.
 */
function StepHeading({ title }: { title: string }) {
  return <div className="t-headline">{title}</div>;
}

function SummaryLine({ icon, label, text }: { icon: "lightning"; label: string; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-neutral-800/40 px-3 py-2">
      <Icon name={icon} size={12} className="flex-none text-warning-fg" />
      <span className="text-[11px] text-neutral-600">{label}:</span>
      <span className="min-w-0 flex-1 text-[12px] text-neutral-200">{text}</span>
    </div>
  );
}

/** One pickable recipe — the same card for a trigger and for an action, since both are "a thing you choose". */
function OptionCard({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors max-md:min-h-[64px] max-md:p-3.5",
        active
          ? "border-accent-600 bg-accent-950"
          : "border-neutral-800 bg-transparent hover:border-neutral-700 hover:bg-neutral-800/40",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 flex-none items-center justify-center rounded-md transition-colors",
          active ? "bg-accent-700 text-white" : "bg-neutral-800 text-neutral-400",
        )}
      >
        <Icon name={icon} size={14} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-100 max-md:text-[15px]">
          {title}
          {active && <Icon name="check-circle" size={12} className="flex-none text-accent-300" />}
        </span>
        <span className="text-[11px] leading-snug text-neutral-600 max-md:text-[13px]">{description}</span>
      </span>
    </button>
  );
}
