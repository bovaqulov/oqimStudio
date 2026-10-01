import { AUTH_COPY } from "./messages";

export interface PasswordStrength {
  /** 0–4, matching the five labels in `AUTH_COPY.strength.levels`. */
  score: number;
  label: string;
  /** Concrete next steps, e.g. "raqam qo'shing" — never a bare "weak". */
  tips: string[];
}

/**
 * A deliberately small strength meter: length first, then variety.
 *
 * No dictionary and no library — the point is to steer someone away from
 * "12345678" while they type, not to score entropy. A real deployment can
 * swap the body for zxcvbn without touching the component that renders it.
 */
export function scorePassword(password: string): PasswordStrength {
  const tips: string[] = [];
  if (!password) return { score: 0, label: AUTH_COPY.strength.levels[0], tips: [AUTH_COPY.strength.tips.length] };

  const hasLetter = /[a-z]/i.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const long = password.length >= 12;

  let score = 0;
  if (password.length >= 8) score += 1;
  else tips.push(AUTH_COPY.strength.tips.length);
  if (hasLetter && hasNumber) score += 1;
  else tips.push(hasLetter ? AUTH_COPY.strength.tips.number : AUTH_COPY.strength.tips.letter);
  if (hasUpper) score += 1;
  else tips.push(AUTH_COPY.strength.tips.case);
  if (hasSymbol || long) score += 1;
  else tips.push(AUTH_COPY.strength.tips.symbol);

  // A repeated or sequential run gives the illusion of length; cap it.
  if (/^(.)\1+$/.test(password) || /12345|qwerty|parol|password/i.test(password)) {
    score = Math.min(score, 1);
  }

  return {
    score: Math.min(4, score),
    label: AUTH_COPY.strength.levels[Math.min(4, score)]!,
    tips: tips.slice(0, 2),
  };
}

/** The bar the signup form refuses to go below. */
export function isPasswordAcceptable(password: string): boolean {
  return password.length >= 8 && /[a-z]/i.test(password) && /\d/.test(password);
}
