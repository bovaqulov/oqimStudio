"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { ToggleChip } from "@/components/ui/ToggleChip";
import type { BusinessMediaKind, BusinessTriggerConfig } from "@/features/flows";
import {
  BUSINESS_MATCH_KINDS,
  BUSINESS_MEDIA_KINDS,
  BUSINESS_SIGNAL,
  businessCommandName,
  businessConfigForMatch,
  businessMatch,
  businessMatchHoldsValue,
  businessMediaKinds,
  businessSchedule,
  businessSectionCount,
  businessSummaryParts,
  businessTriggerIssues,
  createBusinessTrigger,
  getBusinessMatch,
  type BusinessSection,
} from "../../../lib/trigger";
import { AccordionSection } from "./AccordionSection";
import { BusinessScheduleField } from "./BusinessScheduleField";
import { CommandInput } from "./CommandInput";
import { FieldGroup } from "./FieldGroup";
import { FieldHint } from "./FieldHint";
import { FieldLabel } from "./FieldLabel";
import { KeywordField } from "./KeywordField";
import { RevealPanel } from "./RevealPanel";

function toggle<T>(list: T[], key: T): T[] {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

/**
 * What narrows a Handler in the `business` module. Every one of them answers
 * the same thing — a new message to the connected account, from any of its
 * chats — and two layers narrow it down:
 *
 *   1. Shartlar — what is inside the message
 *   2. Qachon   — whether it arrived inside the account's working hours
 *
 * Each is its own fold and only the first is open, so the panel opens on one
 * question rather than on a form. A folded section carries its own hint and
 * count — which is why the summary sentence that used to sit above them, and
 * the raw `business_message` label under it, are gone: both restated what the
 * two section headers already say, at the cost of half the panel (asked for as
 * "maksimal qisqartirish"). The API name survives in the media chips' tooltips
 * for whoever is checking against the docs.
 *
 * Neither the update nor the audience is a choice: only `business_message`
 * carries a message the layers below can read, and a Handler answers the
 * whole inbox.
 */
export function BusinessTriggerField({
  business,
  onChange,
}: {
  business?: BusinessTriggerConfig;
  onChange: (config: BusinessTriggerConfig) => void;
}) {
  const match = businessMatch(business);
  const mediaKinds = businessMediaKinds(business);
  const schedule = businessSchedule(business);

  const issues = businessTriggerIssues(business);
  // The first section, plus any section already holding something wrong: a fold
  // is allowed to save the reader a scroll, never to keep a broken layer quiet.
  const [open, setOpen] = useState<BusinessSection[]>(() => [
    ...new Set<BusinessSection>(["match", ...issues.map((issue) => issue.section)]),
  ]);

  const parts = businessSummaryParts(business);
  const hintOf = (section: BusinessSection) => parts.find((part) => part.section === section)?.label ?? "";
  const issueOf = (section: BusinessSection) =>
    issues.find((issue) => issue.section === section && issue.level === "error")?.level ??
    issues.find((issue) => issue.section === section)?.level;

  function toggleSection(section: BusinessSection) {
    setOpen((current) => toggle(current, section));
  }

  /**
   * Saves the whole config, not the edited field: the resolved values overwrite
   * the stored ones on purpose, so the first edit of a config written before a
   * layer existed writes that layer's default down rather than leaving the
   * block reading one thing and saving another.
   */
  function commit(patch: Partial<BusinessTriggerConfig>) {
    onChange({
      ...(business ?? createBusinessTrigger()),
      messageTypes: [BUSINESS_SIGNAL.key],
      match,
      schedule,
      ...patch,
    });
  }

  // A Handler with nothing selected matches nothing and says so nowhere — on
  // the card it simply loses its tags — so the last chip in a group stays on.
  function toggleMediaKind(key: BusinessMediaKind) {
    const next = toggle(mediaKinds, key);
    if (next.length) commit({ mediaKinds: next });
  }

  function matchBody() {
    if (match === "keyword") {
      return (
        <KeywordField
          keywords={business?.keywords ?? ""}
          match={business?.keywordMatch ?? "contains"}
          flags={business?.keywordFlags ?? "i"}
          onChange={(patch) => commit(patch)}
        />
      );
    }
    if (match === "command") {
      return (
        <>
          <FieldLabel>Buyruq nomi</FieldLabel>
          <CommandInput value={businessCommandName(business)} onChange={(command) => commit({ command })} />
        </>
      );
    }
    return (
      <>
        <FieldGroup legend="Qaysi turdagi fayl" note="bir nechtasi mumkin">
          {BUSINESS_MEDIA_KINDS.map((meta) => (
            <ToggleChip
              key={meta.key}
              select="multi"
              check
              active={mediaKinds.includes(meta.key)}
              title={`${meta.label}\n${meta.api}`}
              onClick={() => toggleMediaKind(meta.key)}
            >
              {meta.label}
            </ToggleChip>
          ))}
        </FieldGroup>
        <FieldHint>Matnli xabarlar bu blokka tushmaydi — faqat tanlangan turlar.</FieldHint>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ---------------------------- Shartlar: match --------------------------- */}
      <AccordionSection
        title="Shartlar"
        icon="text-aa"
        hint={hintOf("match")}
        count={businessSectionCount(business, "match")}
        issue={issueOf("match")}
        open={open.includes("match")}
        onToggle={() => toggleSection("match")}
      >
        <div
          className="flex flex-col gap-1.5"
        >
          <SegmentedTabs
            grow
            label="Xabar tarkibi bo'yicha filtr"
            tone={match === "any" ? "neutral" : "accent"}
            value={match}
            onChange={(key) => onChange(businessConfigForMatch(business, key))}
            options={BUSINESS_MATCH_KINDS.map((meta) => ({
              value: meta.key,
              label: meta.label,
              icon: meta.icon,
              title: meta.hint,
              // Says the option still holds what was typed into it, so looking at
              // another kind is not the leap of faith it looks like.
              dot: meta.key !== match && businessMatchHoldsValue(business, meta.key),
            }))}
          />
          <FieldHint>{getBusinessMatch(match).hint}</FieldHint>
          {match === "any" ? null : <RevealPanel>{matchBody()}</RevealPanel>}
        </div>
      </AccordionSection>

      {/* ------------------------------ Qachon: hours --------------------------- */}
      <AccordionSection
        title="Qachon"
        icon="clock"
        hint={hintOf("schedule")}
        count={businessSectionCount(business, "schedule")}
        issue={issueOf("schedule")}
        open={open.includes("schedule")}
        onToggle={() => toggleSection("schedule")}
      >
        <div
        >
          <BusinessScheduleField schedule={schedule} onChange={(next) => commit({ schedule: next })} />
        </div>
      </AccordionSection>
    </div>
  );
}
