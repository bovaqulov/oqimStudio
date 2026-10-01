/** Groups an integer with thin spaces every 3 digits: 6240 -> "6 240". */
export function formatThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Formats a so'm amount for display, e.g. 890000 -> "890 000 so'm". */
export function formatSom(value: number): string {
  return `${formatThousands(value)} so'm`;
}

/** Splits a full name into initials for an Avatar: "Aziza Sultonova" -> "AS". */
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}


/**
 * A count, said one way everywhere: "5 ta oqim".
 *
 * The product had two spellings of the same fact — "Oqimlar 5" beside a heading
 * on one screen and "1 ta kontakt" on another — and a reader comparing two
 * screens should not have to work out that they mean the same shape. Uzbek has
 * no plural agreement to get wrong here, so the noun is passed through as
 * written.
 *
 * `noun` is omitted where a heading directly above already names the thing;
 * the result is then "5 ta", which is the same sentence with the subject
 * elided rather than a second format.
 */
export function countOf(value: number, noun?: string): string {
  return noun ? `${value} ta ${noun}` : `${value} ta`;
}
