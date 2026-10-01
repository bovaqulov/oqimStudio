import type { IconName } from "@/components/ui/Icon";
import type { Tone } from "@/components/ui/types";

/**
 * How far along an integration is. The stage decides everything the card shows
 * — badge, colour, what the button does — so a reader never has to guess what
 * "Rejada" means or what pressing a button will actually do.
 */
export type IntegrationStage = "available" | "soon" | "planned" | "considering";

export interface IntegrationStageDefinition {
  key: IntegrationStage;
  label: string;
  tone: Tone;
  /** What this stage means, in one sentence — the legend and the tooltip both read it. */
  meaning: string;
}

export const INTEGRATION_STAGES: IntegrationStageDefinition[] = [
  {
    key: "available",
    label: "Ishlaydi",
    tone: "success",
    meaning: "Hozir ulash mumkin — sozlagach oqimlarda ishlatiladi.",
  },
  {
    key: "soon",
    label: "Tez orada",
    tone: "accent",
    meaning: "Ishlab chiqilmoqda, yaqin oylarda ochiladi. Tayyor bo'lganda xabar beramiz.",
  },
  {
    key: "planned",
    label: "Rejada",
    tone: "warning",
    meaning: "Yo'l xaritasida bor, lekin sana belgilanmagan. Ovozingiz navbatga ta'sir qiladi.",
  },
  {
    key: "considering",
    label: "Muhokamada",
    tone: "neutral",
    meaning: "Talab o'rganilmoqda. Kerak bo'lsa bildiring — shu asosda qaror qilinadi.",
  },
];

export function getIntegrationStage(stage: IntegrationStage): IntegrationStageDefinition {
  return INTEGRATION_STAGES.find((item) => item.key === stage) ?? INTEGRATION_STAGES[3]!;
}

export interface IntegrationRowData {
  name: string;
  icon: IconName;
  description: string;
  stage: IntegrationStage;
  /** Where an available integration is configured. */
  href?: string;
  /**
   * Where it is configured, when that is not a page of its own.
   *
   * Two of the three working integrations are set up inside a flow block rather
   * than on a screen, so their rows have nowhere to go and did not react to a
   * press. Beside a row that does navigate, that reads as broken rather than as
   * different — hence a word saying where it actually lives.
   */
  configuredIn?: string;
}

export const INTEGRATIONS: IntegrationRowData[] = [
  {
    name: "Telegram Payments",
    icon: "credit-card",
    description: "Click, Payme, Uzum va Stripe — bot ichida to'lov qabul qilish",
    stage: "available",
    href: "/bots",
  },
  {
    name: "Webhook",
    icon: "arrows-left-right",
    description: "Ixtiyoriy tizimga POST so'rov yuborish",
    stage: "available",
    configuredIn: "Oqim ichida",
  },
  {
    name: "AI modellari",
    icon: "sparkle",
    description: "AI bloklari uchun model, temperature va bilim bazasi",
    stage: "available",
    configuredIn: "Oqim ichida",
  },
  {
    name: "Google Sheets",
    icon: "table",
    description: "Lidlarni jadvalga yozish va o'qish",
    stage: "soon",
  },
  {
    name: "amoCRM",
    icon: "kanban",
    description: "Sdelka yaratish, bosqichni yangilash",
    stage: "soon",
  },
  {
    name: "Bitrix24",
    icon: "buildings",
    description: "Lid va vazifalar sinxronizatsiyasi",
    stage: "soon",
  },
  {
    name: "Eskiz.uz SMS",
    icon: "chat-dots",
    description: "Javob bermaganlarga SMS yuborish",
    stage: "planned",
  },
  {
    name: "1C",
    icon: "database",
    description: "Mahsulot va qoldiq almashinuvi",
    stage: "considering",
  },
];
