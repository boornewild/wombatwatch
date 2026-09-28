import { classifyFailure, isAuthError, isAuthErrorStr, isNetworkError } from './classify';

describe('isNetworkError', () => {
  it.each([
    'TypeError: Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'net::ERR_INTERNET_DISCONNECTED',
    'AbortError: The operation was aborted.',
    'failed to FETCH',
  ])('%s is a network error', (s) => expect(isNetworkError(s, true)).toBe(true));

  it.each(['', 'duplicate key value (23505)', 'JWT expired (PGRST301)'])('%s is not', (s) =>
    expect(isNetworkError(s, true)).toBe(false),
  );

  it('is always true when offline, whatever the message', () => {
    expect(isNetworkError('duplicate key value (23505)', false)).toBe(true);
    expect(isNetworkError(null, false)).toBe(true);
  });

  it('treats null and undefined as an empty string', () => {
    expect(isNetworkError(null, true)).toBe(false);
    expect(isNetworkError(undefined, true)).toBe(false);
  });

  it('Characterisation: any message containing "TypeError" counts, even a code bug', () => {
    expect(isNetworkError("TypeError: Cannot read properties of undefined (reading 'id')", true)).toBe(true);
  });
});

describe('isAuthErrorStr', () => {
  it.each(['JWT expired (PGRST301)', 'PGRST301', 'invalid jwt', 'Not authenticated', 'status 401'])('%s is auth', (s) =>
    expect(isAuthErrorStr(s)).toBe(true),
  );

  it.each(['', null, undefined, 'permission denied for table wombats (42501)'])('%s is not', (s) =>
    expect(isAuthErrorStr(s)).toBe(false),
  );

  it('Characterisation: "401" anywhere matches, including inside other numbers', () => {
    expect(isAuthErrorStr('invalid input syntax for burrow 14012 (22P02)')).toBe(true);
  });
});

describe('classifyFailure', () => {
  it('checks network first, then auth, like flushQueue', () => {
    expect(classifyFailure('TypeError: Failed to fetch', true)).toBe('network');
    expect(classifyFailure('JWT expired (PGRST301)', true)).toBe('auth');
    expect(classifyFailure('new row violates row-level security policy (42501)', true)).toBe('genuine');
  });

  it('Characterisation: an auth error while offline is classified as network', () => {
    expect(classifyFailure('JWT expired (PGRST301)', false)).toBe('network');
  });

  it('Characterisation: a message matching both patterns is network', () => {
    expect(classifyFailure('TypeError: jwt missing', true)).toBe('network');
  });

  it('an empty error string online is genuine', () => {
    expect(classifyFailure('', true)).toBe('genuine');
  });
});

describe('isAuthError', () => {
  it('matches status 401, PGRST301 and jwt / not authenticated messages', () => {
    expect(isAuthError({ message: 'Unauthorized', status: 401 })).toBe(true);
    expect(isAuthError({ message: 'x', code: 'PGRST301' })).toBe(true);
    expect(isAuthError({ message: 'JWT expired' })).toBe(true);
    expect(isAuthError({ message: 'User Not Authenticated' })).toBe(true);
  });

  it('ignores other errors and empty input', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError({ message: 'duplicate key', code: '23505' })).toBe(false);
    expect(isAuthError({})).toBe(false);
  });

  it('Characterisation: "401" in the message alone does not count (unlike isAuthErrorStr)', () => {
    expect(isAuthError({ message: 'HTTP 401' })).toBe(false);
    expect(isAuthErrorStr('HTTP 401')).toBe(true);
  });

  it('Characterisation: code match is case-sensitive, message match is not', () => {
    expect(isAuthError({ message: 'x', code: 'pgrst301' })).toBe(false);
    expect(isAuthError({ message: 'JwT' })).toBe(true);
  });
});
