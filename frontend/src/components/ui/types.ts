/**
 * Shared status vocabulary. Every domain (projects, bots, flows, billing…)
 * reports status through this one type instead of inventing its own
 * "active/paused/pending" flavor per feature (DRY) — Badge is the single
 * place that turns a Tone into color.
 */
export type Tone = "success" | "warning" | "neutral" | "accent" | "danger";

export interface Labeled {
  label: string;
}

export interface StatusLabel extends Labeled {
  tone: Tone;
}
