/**
 * CSV for export/import. Known parseCSV limitations (pinned in csv.test.ts): quoted newlines break rows,
 * and quote marks inside values are dropped.
 */

type Cell = string | number | boolean | null | undefined;

const escapeCell = (v: Cell): string => {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (headers: Cell[], rows: Cell[][]): string =>
  [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');

const splitLine = (line: string): string[] => {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  return cols.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
};

export const parseCSV = (text: string): { headers: string[]; rows: string[][] } => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitLine(lines[0]!);
  const rows = lines.slice(1).map(splitLine).filter((r) => r.some((c) => c));
  return { headers, rows };
};
