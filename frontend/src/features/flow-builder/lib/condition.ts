import type { ChatType, ConditionConfig, ConditionField, ConditionOperator, ConditionRule, MediaKind } from "@/features/flows";

/** Record (not a plain array) so TypeScript forces this to stay exhaustive as `ConditionField` grows. */
export const FIELD_LABELS: Record<ConditionField, string> = {
  message_text: "Xabar matni",
  command: "Buyruq",
  user_username: "Foydalanuvchi username",
  user_first_name: "Foydalanuvchi ismi",
  chat_type: "Chat turi",
  chat_title: "Chat nomi",
  media_type: "Media turi",
  business_connection_id: "Business ulanish ID",
  variable: "O'zgaruvchi / teg",
  datetime: "Sana/vaqt",
};

export const FIELD_OPTIONS: { value: ConditionField; label: string }[] = (
  Object.keys(FIELD_LABELS) as ConditionField[]
).map((value) => ({ value, label: FIELD_LABELS[value] }));

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "teng",
  not_equals: "teng emas",
  contains: "o'z ichiga oladi",
  not_contains: "o'z ichiga olmaydi",
  starts_with: "bilan boshlanadi",
  ends_with: "bilan tugaydi",
  is_empty: "bo'sh",
  is_not_empty: "bo'sh emas",
  after: "keyin",
  before: "oldin",
};

const TEXT_OPERATORS: ConditionOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];
const ENUM_OPERATORS: ConditionOperator[] = ["equals", "not_equals"];
const DATETIME_OPERATORS: ConditionOperator[] = ["equals", "not_equals", "after", "before"];

export function operatorsForField(field: ConditionField): ConditionOperator[] {
  if (field === "chat_type" || field === "media_type") return ENUM_OPERATORS;
  if (field === "datetime") return DATETIME_OPERATORS;
  return TEXT_OPERATORS;
}

export function operatorNeedsValue(operator: ConditionOperator): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

export const CHAT_TYPE_OPTIONS: { value: ChatType; label: string }[] = [
  { value: "private", label: "Shaxsiy" },
  { value: "group", label: "Guruh" },
  { value: "supergroup", label: "Katta guruh" },
  { value: "channel", label: "Kanal" },
];

export const MEDIA_TYPE_OPTIONS: { value: MediaKind; label: string }[] = [
  { value: "photo", label: "Rasm" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "voice", label: "Ovozli xabar" },
  { value: "document", label: "Hujjat" },
];

export function createConditionRule(): ConditionRule {
  return {
    id: `c${Date.now()}${Math.round(Math.random() * 1000)}`,
    negate: false,
    field: "message_text",
    operator: "contains",
    value: "",
  };
}

/** Human-readable one-liner for the canvas card and the trigger/condition list — kept in sync with `node.text`. */
export function summarizeCondition(config: ConditionConfig): string {
  if (!config.rules.length) return "Shart qo'shilmagan";
  return config.rules
    .map((rule) => {
      const subject = rule.field === "variable" && rule.variableName ? rule.variableName : FIELD_LABELS[rule.field];
      const prefix = rule.negate ? "EMAS: " : "";
      const suffix = operatorNeedsValue(rule.operator) ? ` ${rule.value}` : "";
      return `${prefix}${subject} ${OPERATOR_LABELS[rule.operator]}${suffix}`.trim();
    })
    .join(config.combinator === "AND" ? " VA " : " YOKI ");
}
