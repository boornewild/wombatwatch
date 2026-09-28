/** Display formatting for dates and statuses. Dates render in the device's local time, DD/MM/YYYY. */

const pad2 = (n: number) => String(n).padStart(2, '0');
const dmy = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

export const fmtDate = (s?: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return dmy(d);
};

/** Like fmtDate, plus h:mm AM/PM when the string includes a time. */
export const fmtDateTime = (s?: string | null): string => {
  if (!s) return '—';
  const hasTime = (s.length > 10 && s.includes('T')) || (s.includes(' ') && s.split(' ')[1]?.includes(':'));
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  if (!hasTime) return dmy(d);
  const h = d.getHours();
  return `${dmy(d)} ${h % 12 || 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
};

export const timeAgo = (s?: string | null): string => {
  if (!s) return '';
  const hours = Math.floor((Date.now() - new Date(s).getTime()) / 36e5);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
};

/** Today's date as YYYY-MM-DD in UTC (legacy behaviour). Before 10–11am in NSW this is still yesterday's date. */
export const today = (): string => new Date().toISOString().slice(0, 10);

const capitalise = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const WOMBAT_TONES: Record<string, string> = { healthy: 'sage', under_treatment: 'amber', deceased: 'rose', archived: 'pearl' };
const WOMBAT_LABELS: Record<string, string> = { healthy: 'Healthy', under_treatment: 'Treatment', deceased: 'Deceased', archived: 'Archived' };
const BURROW_TONES: Record<string, string> = { active: 'sage', inactive: 'amber', damaged: 'rose' };
const BURROW_LABELS: Record<string, string> = { active: 'Active', inactive: 'Inactive', damaged: 'Damaged' };

export const statusTone = (s: string) => WOMBAT_TONES[s] || 'pearl';
export const statusLabel = (s: string) => WOMBAT_LABELS[s] || capitalise(s);
export const burrowTone = (s: string) => BURROW_TONES[s] || 'pearl';
export const burrowStatusLabel = (s: string) => BURROW_LABELS[s] || capitalise(s);

export const isInactive = (w: { status?: string | null }) => w.status === 'deceased';
export const isArchived = (w: { status?: string | null }) => w.status === 'archived';
