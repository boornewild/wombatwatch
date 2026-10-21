/**
 * Why an invite link didn't work. join_squad_by_invite (DB function) returns { error: code } instead of throwing,
 * so these codes must be shown to the volunteer explicitly (bug #1: they used to be ignored).
 */
const MESSAGES: Record<string, string> = {
  expired: 'This invite link has expired. Ask your group admin for a new one.',
  max_uses_reached: 'This invite link has already been used the maximum number of times. Ask your group admin for a new one.',
  invalid_token: 'This invite link is invalid or has been revoked. Ask your group admin for a new one.',
};

export const inviteErrorMessage = (code: string): string =>
  MESSAGES[code] ?? "We couldn't use this invite link. Ask your group admin for a new one.";

/** Dismissible notice at the top of the app for a volunteer whose invite link was refused. */
export function InviteErrorBanner({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 'calc(var(--sat, 0px) + 10px)',
        left: 12,
        right: 12,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        background: '#FBECCF',
        color: '#5A3A0C',
        borderRadius: 14,
        padding: '12px 12px 12px 14px',
        fontSize: 13.5,
        lineHeight: 1.45,
        boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
      }}
    >
      <span style={{ flex: 1 }}>{inviteErrorMessage(code)}</span>
      <button aria-label="Dismiss" onClick={onDismiss} style={{ border: 'none', background: 'none', fontSize: 20, lineHeight: 1, color: '#5A3A0C' }}>
        ×
      </button>
    </div>
  );
}
