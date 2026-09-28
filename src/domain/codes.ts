/**
 * Human-readable record codes: W0001 for wombats, B0001 for burrows.
 * Volunteers write these on field sheets, so an existing code must never change unless it's a duplicate.
 */
export type CodePrefix = 'W' | 'B';
type Coded = { code?: string | null };

const codeNumber = (code?: string | null): number => parseInt((code || '').slice(1) || '0', 10);
const formatCode = (prefix: CodePrefix, n: number): string => prefix + String(n).padStart(4, '0');

/** Lowest unused code number, so gaps left by deletions are reused. */
export function nextCode(records: Coded[], prefix: CodePrefix): string {
  const used = new Set(records.map((r) => codeNumber(r.code)).filter((n) => n > 0));
  let n = 1;
  while (used.has(n)) n++;
  return formatCode(prefix, n);
}

export const nextWombatCode = (wombats: Coded[]): string => nextCode(wombats, 'W');
export const nextBurrowCode = (burrows: Coded[]): string => nextCode(burrows, 'B');

/**
 * Fixes duplicate codes created when two volunteers add records offline and both get the same number.
 * The earliest record (by `createdAt`) keeps its code; later duplicates and code-less records get numbers
 * above the current maximum. Returns records sorted by `createdAt`, plus only the ones that changed
 * (so callers can patch just those in Supabase).
 */
export function deduplicateCodes<T extends Coded & { createdAt?: string | null }>(
  records: T[],
  prefix: CodePrefix,
): { records: T[]; changed: T[] } {
  const seen = new Set<string>();
  const changed: T[] = [];
  const sorted = [...records].sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0));
  const numbers = sorted.map((r) => codeNumber(r.code)).filter((n) => n > 0);
  let next = (numbers.length ? Math.max(...numbers) : 0) + 1;

  const out = sorted.map((r) => {
    const code = r.code || '';
    if (code && !seen.has(code)) {
      seen.add(code);
      return r;
    }
    const updated = { ...r, code: formatCode(prefix, next++) };
    seen.add(updated.code);
    changed.push(updated);
    return updated;
  });
  return { records: out, changed };
}
