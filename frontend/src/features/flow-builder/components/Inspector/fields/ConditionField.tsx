"use client";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils/cn";
import type { ConditionConfig, ConditionField as ConditionFieldType, ConditionOperator, ConditionRule } from "@/features/flows";
import {
  CHAT_TYPE_OPTIONS,
  FIELD_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  OPERATOR_LABELS,
  createConditionRule,
  operatorNeedsValue,
  operatorsForField,
} from "../../../lib/condition";
import { ANSWER_SLOTS } from "../../../lib/variables";
import { ADVANCED_SECTION_TITLE } from "./advanced-fields";
import { CollapsibleSection } from "./CollapsibleSection";
import { FieldLabel } from "./FieldLabel";
import { VariableInput } from "./VariableInput";

/** A value that actually matches something, per subject — a placeholder reading "qiymat" teaches nobody what fits. */
const VALUE_SAMPLE: Partial<Record<ConditionFieldType, string>> = {
  message_text: "narx",
  command: "start",
  user_username: "azizkarimov",
  user_first_name: "Aziz",
  chat_title: "Mijozlar guruhi",
  business_connection_id: "bZc9Kq1",
  variable: "ha",
  datetime: "2026-08-10 09:00",
};

/**
 * What a "Shart" block compares. Three questions per rule — what is being
 * looked at, how, and against what — and nothing else in the way.
 *
 * VA/YOKI folds. It is one setting for the whole block, it is answered once,
 * and it was sitting in the header above rules that had not been written yet.
 * The word itself still prints between the rule cards, so the block never hides
 * which way it combines — only the control for changing it moves.
 */
export function ConditionField({
  value,
  onChange,
}: {
  value?: ConditionConfig;
  onChange: (value: ConditionConfig) => void;
}) {
  const combinator = value?.combinator ?? "AND";
  const rules = value?.rules?.length ? value.rules : [createConditionRule()];

  function commit(patch: Partial<ConditionConfig>) {
    onChange({ combinator, rules, ...patch });
  }
  function updateRule(id: string, patch: Partial<ConditionRule>) {
    commit({ rules: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  }
  function removeRule(id: string) {
    const next = rules.filter((rule) => rule.id !== id);
    commit({ rules: next.length ? next : [createConditionRule()] });
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>Shartlar</FieldLabel>

      <div className="flex flex-col gap-2">
        {rules.map((rule, index) => {
          const field = rule.field;
          const showValue = operatorNeedsValue(rule.operator);
          return (
            <div key={rule.id} className="flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-neutral-800/40 p-[9px]">
              <div className="flex items-center gap-1.5">
                {index > 0 && (
                  <span className="text-[10px] max-md:text-[12px] font-medium text-neutral-600">{combinator === "AND" ? "VA" : "YOKI"}</span>
                )}
                <button
                  type="button"
                  onClick={() => updateRule(rule.id, { negate: !rule.negate })}
                  title="Shartni teskarisiga aylantirish"
                  className={cn(
                    "rounded border px-[6px] py-[2px] text-[10px] max-md:text-[12px] font-semibold tracking-[.04em] transition-colors",
                    rule.negate
                      ? "border-accent-700 bg-accent-800 text-accent-ink"
                      : "border-neutral-800 text-neutral-600 hover:border-neutral-600",
                  )}
                >
                  EMAS
                </button>
                <span className="flex-1" />
                <IconButton icon="x" label="Shartni o'chirish" size={22} onClick={() => removeRule(rule.id)} />
              </div>

              <label className="flex flex-col gap-1">
                <FieldLabel>Nima tekshiriladi?</FieldLabel>
                <Select
                  value={field}
                  onChange={(event) => {
                    const nextField = event.target.value as ConditionFieldType;
                    updateRule(rule.id, { field: nextField, operator: operatorsForField(nextField)[0], value: "" });
                  }}
                >
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>

              {field === "variable" && (
                <label className="flex flex-col gap-1">
                  <FieldLabel>Qaysi javob?</FieldLabel>
                  <Select
                    value={rule.variableName ?? ""}
                    onChange={(event) => updateRule(rule.id, { variableName: event.target.value })}
                  >
                    <option value="" disabled>
                      Tanlang
                    </option>
                    {/* The names the flow's own "save the answer" blocks write —
                        chosen from a list rather than recalled and retyped. */}
                    {ANSWER_SLOTS.map((slot) => (
                      <option key={slot.key} value={slot.key}>
                        {slot.label}
                      </option>
                    ))}
                    {!!rule.variableName && !ANSWER_SLOTS.some((slot) => slot.key === rule.variableName) && (
                      <option value={rule.variableName}>{rule.variableName}</option>
                    )}
                  </Select>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <FieldLabel>Shart</FieldLabel>
                <Select
                  value={rule.operator}
                  onChange={(event) => updateRule(rule.id, { operator: event.target.value as ConditionOperator })}
                >
                  {operatorsForField(field).map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </Select>
              </label>

              {showValue && (
                <label className="flex flex-col gap-1">
                  <FieldLabel>Qiymat</FieldLabel>
                  {field === "chat_type" ? (
                    <Select value={rule.value} onChange={(event) => updateRule(rule.id, { value: event.target.value })}>
                      <option value="" disabled>
                        Tanlang
                      </option>
                      {CHAT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : field === "media_type" ? (
                    <Select value={rule.value} onChange={(event) => updateRule(rule.id, { value: event.target.value })}>
                      <option value="" disabled>
                        Tanlang
                      </option>
                      {MEDIA_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <VariableInput
                      value={rule.value}
                      onChange={(next) => updateRule(rule.id, { value: next })}
                      placeholder={VALUE_SAMPLE[field] ?? "qiymat"}
                      sample={VALUE_SAMPLE[field]}
                    />
                  )}
                </label>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => commit({ rules: [...rules, createConditionRule()] })}
        className="flex items-center gap-1 self-start rounded-md border border-dashed border-neutral-700 px-[10px] py-[5px] text-[11.5px] max-md:text-[13px] text-neutral-400 hover:border-accent-500 hover:text-accent-400"
      >
        <Icon name="plus" size={11} /> Shart
      </button>

      <CollapsibleSection
        title={ADVANCED_SECTION_TITLE}
        summary={combinator === "AND" ? "Barcha shartlar bajarilsa" : "Shartlardan biri bajarilsa"}
      >
        <div className="flex flex-col gap-1">
          <FieldLabel>Bir nechta shart bo&apos;lganda</FieldLabel>
          <SegmentedTabs
            options={[
              { value: "AND", label: "Hammasi (VA)" },
              { value: "OR", label: "Bittasi (YOKI)" },
            ]}
            value={combinator}
            onChange={(next) => commit({ combinator: next })}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
}
