/**
 * Which of a block's controls lead, and which fold away.
 *
 * Opening a block used to mean meeting everything it can do at once — a Xabar
 * block put the name, the content picker, the file source, the body, the
 * keyboard, the keyboard type and the delay on screen before the author had
 * decided what the message says. The rule this table encodes is that a block
 * leads with at most three questions, and the rest lives one click away under
 * [[ADVANCED_SECTION_TITLE]].
 *
 * The table is per block type rather than per field because "secondary" is not
 * a property of a field: the keyboard type is noise on a Xabar block and the
 * whole point of a Menyu one.
 */

/** The one heading every folded-away setting hides behind, so it reads as the same drawer everywhere. */
export const ADVANCED_SECTION_TITLE = "Qo'shimcha sozlamalar";

/**
 * A control the Inspector places for a block, named for what the author calls
 * it rather than for the field it writes — `saveAnswer` is "Qayerga saqlash",
 * not `tagName`.
 */
export type NodeFieldSlot =
  /** Blok nomi. */
  | "title"
  /** The block's own text: Matn, Savol matni, Vazifa. */
  | "body"
  /** Rasm/fayl — what the block sends and where the file comes from. */
  | "content"
  /** The media attachment on a block that also sends text. */
  | "media"
  | "formatting"
  | "preview"
  | "buttons"
  | "buttonMode"
  /** Bir qatorda nechta tugma. */
  | "buttonLayout"
  /** "Orqaga" tugmasi. */
  | "backButton"
  /** Bu blok ochilganda avvalgi xabar bilan nima bo'ladi. */
  | "incomingTransition"
  /** Qayerga saqlash. */
  | "saveAnswer"
  /** O'zgaruvchi + shart + qiymat. */
  | "condition"
  /** VA / YOKI. */
  | "combinator"
  /** Aks holda tarmog'i. */
  | "elseBranch"
  | "knowledge"
  /** Javob topilmasa. */
  | "fallback"
  /** Model, temperature, token limiti, tarix chuqurligi. */
  | "model"
  | "delay"
  /** Mahsulot nomi. */
  | "product"
  | "price"
  | "provider"
  /** Tavsif, rasm, yetkazib berish, valyuta. */
  | "invoiceExtras"
  | "priority"
  | "extract";

/**
 * The at-most-three controls each block leads with. Keyed by string rather than
 * by `NodeType` so a block type that does not exist yet can already have an
 * opinion here, and a grouping that only starts working after it lands would
 * ship the block unranked.
 */
const PRIMARY: Readonly<Record<string, readonly NodeFieldSlot[]>> = {
  message: ["body", "buttons", "content"],
  condition: ["condition"],
  ai: ["body", "knowledge", "saveAnswer"],
  invoice: ["product", "price", "provider"],
  // The two blocks a delay belongs to. Everywhere else it is an afterthought
  // and folds; here it is the block, and folding it would leave Kutish opening
  // on nothing at all.
  delay: ["body", "delay"],
  followup: ["body", "delay"],
  // Tugatish sets nothing else at all. Its name is secondary everywhere else
  // and would fold here too, which would leave the panel opening on a closed
  // drawer and nothing besides.
  end: ["title"],
};

/**
 * Secondary whatever the block is. This is what an unranked type falls back to
 * — a block nobody has thought about yet still opens without its delay, its
 * keyboard plumbing and its priority in the way, and still shows the fields
 * that are actually its own.
 */
const ALWAYS_SECONDARY: readonly NodeFieldSlot[] = [
  "title",
  "formatting",
  "preview",
  "buttonMode",
  "buttonLayout",
  "backButton",
  "incomingTransition",
  "combinator",
  "elseBranch",
  "model",
  "invoiceExtras",
  "delay",
  "priority",
  "extract",
];

/** Whether this control is one of the block's leading questions. */
export function isPrimaryField(nodeType: string, slot: NodeFieldSlot): boolean {
  const primary = PRIMARY[nodeType];
  return primary ? primary.includes(slot) : !ALWAYS_SECONDARY.includes(slot);
}

/** Whether this control belongs under "Qo'shimcha sozlamalar" for this block. */
export function foldsAway(nodeType: string, slot: NodeFieldSlot): boolean {
  return !isPrimaryField(nodeType, slot);
}
