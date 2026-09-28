import * as f from './format';

// Sydney time (vite.config test.env) — the app's users are in NSW.
describe('fmtDate', () => {
  it('formats DD/MM/YYYY', () => expect(f.fmtDate('2026-03-05')).toBe('05/03/2026'));
  it('returns — for empty or invalid input', () => {
    expect(f.fmtDate('')).toBe('—');
    expect(f.fmtDate(null)).toBe('—');
    expect(f.fmtDate('garbage')).toBe('—');
  });
});

describe('fmtDateTime', () => {
  it('adds 12-hour time when the string has one', () => expect(f.fmtDateTime('2026-03-05T14:07:00+11:00')).toBe('05/03/2026 2:07 PM'));
  it('shows midnight as 12 AM', () => expect(f.fmtDateTime('2026-03-05T00:30:00+11:00')).toBe('05/03/2026 12:30 AM'));
  it('date-only strings stay date-only', () => expect(f.fmtDateTime('2026-03-05')).toBe('05/03/2026'));
  it('returns — for empty input', () => expect(f.fmtDateTime('')).toBe('—'));
});

describe('timeAgo', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it.each([
    ['2026-09-28T11:30:00Z', 'Just now'],
    ['2026-09-28T09:00:00Z', '3h ago'],
    ['2026-09-27T11:00:00Z', 'Yesterday'],
    ['2026-09-24T12:00:00Z', '4d ago'],
    ['', ''],
  ])('%s → %s', (input, expected) => expect(f.timeAgo(input)).toBe(expected));
});

it('today is the UTC date', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T23:30:00Z'));
  expect(f.today()).toBe('2026-09-28');
  vi.useRealTimers();
});

describe('status labels and tones', () => {
  it.each([
    ['healthy', 'Healthy', 'sage'],
    ['under_treatment', 'Treatment', 'amber'],
    ['deceased', 'Deceased', 'rose'],
    ['archived', 'Archived', 'pearl'],
    ['something_new', 'Something_new', 'pearl'],
  ])('wombat %s', (s, label, tone) => {
    expect(f.statusLabel(s)).toBe(label);
    expect(f.statusTone(s)).toBe(tone);
  });
  it.each([
    ['active', 'Active', 'sage'],
    ['inactive', 'Inactive', 'amber'],
    ['damaged', 'Damaged', 'rose'],
    ['flooded', 'Flooded', 'pearl'],
  ])('burrow %s', (s, label, tone) => {
    expect(f.burrowStatusLabel(s)).toBe(label);
    expect(f.burrowTone(s)).toBe(tone);
  });
  it('isInactive / isArchived', () => {
    expect(f.isInactive({ status: 'deceased' })).toBe(true);
    expect(f.isArchived({ status: 'archived' })).toBe(true);
    expect(f.isInactive({ status: 'healthy' })).toBe(false);
  });
});
