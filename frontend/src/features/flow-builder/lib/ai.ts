import type { AiConfig, AiKnowledgeSource, FlowNode } from "@/features/flows";

/**
 * Models an AI block can answer with. Prices are per million tokens, so the
 * picker can show what a choice costs instead of leaving it to guesswork.
 *
 * Product-level catalogue: a workspace picks *from* this list, and a new model
 * is one entry here (Open/Closed) — no component branches on a model id.
 */
export interface AiModelDefinition {
  id: string;
  label: string;
  /** One line on what this model is for, shown under the picker. */
  hint: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  /** Context window in tokens. */
  contextTokens: number;
}

export const AI_MODELS: AiModelDefinition[] = [
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    hint: "Eng kuchli: murakkab savollar, uzun kontekst, ko'p bosqichli mulohaza.",
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    contextTokens: 1_000_000,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "Tezlik va sifat muvozanati — kundalik mijoz savollari uchun.",
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    contextTokens: 1_000_000,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Eng tez va arzon: qisqa javoblar, tasniflash, FAQ.",
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    contextTokens: 200_000,
  },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0]!.id;

export function getAiModel(id: string): AiModelDefinition {
  return AI_MODELS.find((model) => model.id === id) ?? AI_MODELS[0]!;
}

export interface KnowledgeSourceDefinition {
  key: AiKnowledgeSource;
  label: string;
  hint: string;
  /** Whether `knowledgeRef` is used, and what it holds. */
  refLabel: string | null;
  refPlaceholder?: string;
}

/** Where the answer is grounded. "none" is the model's own knowledge — the loosest and the riskiest. */
export const KNOWLEDGE_SOURCES: KnowledgeSourceDefinition[] = [
  {
    key: "none",
    label: "Faqat prompt",
    hint: "Model faqat yuqoridagi ko'rsatma asosida javob beradi.",
    refLabel: null,
  },
  {
    key: "flow_context",
    label: "Suhbat konteksti",
    hint: "Shu suhbatdagi oldingi xabarlar va yig'ilgan o'zgaruvchilar qo'shiladi.",
    refLabel: null,
  },
  {
    key: "knowledge_base",
    label: "Bilim bazasi",
    hint: "Yuklangan hujjatlardan mos parchalar topilib, javobga asos qilinadi.",
    refLabel: "Bilim bazasi nomi",
    refPlaceholder: "masalan: kurslar-narxlari",
  },
  {
    key: "website",
    label: "Sayt sahifasi",
    hint: "Ko'rsatilgan manzil matni javob uchun manba sifatida o'qiladi.",
    refLabel: "URL",
    refPlaceholder: "https://kompaniya.uz/narxlar",
  },
];

export function getKnowledgeSource(key: AiKnowledgeSource): KnowledgeSourceDefinition {
  return KNOWLEDGE_SOURCES.find((source) => source.key === key) ?? KNOWLEDGE_SOURCES[0]!;
}

/** Temperature bounds the UI slider works in. 0 = bir xil javob, 1 = erkin. */
export const AI_TEMPERATURE_MIN = 0;
export const AI_TEMPERATURE_MAX = 1;
export const AI_TEMPERATURE_STEP = 0.1;

export function createAiConfig(): AiConfig {
  return {
    model: DEFAULT_AI_MODEL,
    temperature: 0.3,
    maxTokens: 600,
    knowledgeSource: "flow_context",
    fallbackAction: "message",
    fallbackText: "Kechirasiz, bu savolga javob topa olmadim. Operator tez orada bog'lanadi.",
    handoffOnLowConfidence: true,
  };
}

/** A block's config, with defaults filled in for graphs saved before the field existed. */
export function nodeAiConfig(node: FlowNode): AiConfig {
  return { ...createAiConfig(), ...(node.ai ?? {}) };
}

/** One-line summary for the canvas card and the docked inspector. */
export function summarizeAi(config: AiConfig): string {
  const model = getAiModel(config.model);
  const source = getKnowledgeSource(config.knowledgeSource);
  return `${model.label} · t=${config.temperature.toFixed(1)} · ${source.label}`;
}
