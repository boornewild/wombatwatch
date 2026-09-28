/**
 * Decides why a Supabase write failed, so the flush engine knows whether to pause
 * (network, auth) or charge the op's retry budget (genuine). Pure: no I/O, and
 * `online` is passed in rather than read from navigator so tests can control it.
 */

export type FailureKind = 'network' | 'auth' | 'genuine';

/** The shape checkAuthError inspects: a PostgrestError / StorageError / AuthError. */
export interface ErrorLike {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}

// Regexes copied verbatim from legacy. They match anywhere in the string, so broad
// substrings like "TypeError" or "401" also hit unrelated messages (pinned in tests).
const NETWORK_RE = /TypeError|Load failed|Failed to fetch|NetworkError|net::ERR|AbortError/i;
const AUTH_RE = /401|PGRST301|jwt expired|jwt|not authenticated/i;

/** Transient failure that must not consume retry budget. Offline always counts as network. */
export function isNetworkError(errStr: string | null | undefined, online: boolean): boolean {
  if (!online) return true;
  return NETWORK_RE.test(errStr || '');
}

/** Expired or revoked session: the flush pauses until the user signs in again. */
export function isAuthErrorStr(errStr: string | null | undefined): boolean {
  return AUTH_RE.test(errStr || '');
}

/**
 * Same order flushQueue checks in: network wins over auth, so an offline 401 pauses
 * as network. An op that *threw* is treated as network by flushQueue before this is
 * consulted; that rule lives in the flush engine, not here.
 */
export function classifyFailure(errStr: string | null | undefined, online: boolean): FailureKind {
  if (isNetworkError(errStr, online)) return 'network';
  if (isAuthErrorStr(errStr)) return 'auth';
  return 'genuine';
}

/**
 * Whether a Supabase error object should sign the user out (legacy checkAuthError).
 * Stricter than isAuthErrorStr: "401" in the message alone does not count, only status 401.
 */
export function isAuthError(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return error.status === 401 || error.code === 'PGRST301' || msg.includes('jwt') || msg.includes('not authenticated');
}
