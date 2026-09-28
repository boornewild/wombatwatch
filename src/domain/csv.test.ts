import { toCSV, parseCSV } from './csv';

describe('toCSV', () => {
  it('quotes values containing commas, quotes or newlines; null → empty; CRLF rows', () => {
    expect(toCSV(['a', 'b'], [['x,y', 'say "hi"'], [null, 'line\nbreak'], [undefined, 3]])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n,"line\nbreak"\r\n,3',
    );
  });
});

describe('parseCSV', () => {
  it('round-trips values with commas', () => {
    const rows = [['Bruce', 'St Albans, NSW']];
    expect(parseCSV(toCSV(['name', 'loc'], rows))).toEqual({ headers: ['name', 'loc'], rows });
  });
  // Characterisation: every " toggles quoting and is discarded, so embedded quotes are lost.
  it('drops quote marks inside values (known limitation)', () => {
    expect(parseCSV(toCSV(['note'], [['said "hi"']])).rows).toEqual([['said hi']]);
  });
  it('drops blank lines and trims cells', () => {
    expect(parseCSV('a,b\n x , y \n,\n')).toEqual({ headers: ['a', 'b'], rows: [['x', 'y']] });
  });
  it('handles CR-only line endings', () => {
    expect(parseCSV('a\rb')).toEqual({ headers: ['a'], rows: [['b']] });
  });
  // Characterisation: lines are split before quotes are read, so a quoted newline breaks the row.
  it('does NOT round-trip values containing newlines (known limitation)', () => {
    expect(parseCSV(toCSV(['n'], [['a\nb']])).rows).not.toEqual([['a\nb']]);
  });
});
