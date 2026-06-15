import { randomBytes } from 'node:crypto';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateReconcileCode(): string {
  const bytes = randomBytes(7);
  const suffix = Array.from(bytes)
    .map((b) => CHARS[b % CHARS.length])
    .join('');
  return `TG${suffix}`;
}
