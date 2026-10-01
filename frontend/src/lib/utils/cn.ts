import { clsx, type ClassValue } from "clsx";

/** Merges conditional class names. The single place class-string logic lives (DRY). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
