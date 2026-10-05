/**
 * Records the database kept rejecting, parked on the device (src/sync/failedOps.ts). The chip sits in the
 * dashboard header next to the sync status; the list goes inside the app's modal. Theme colours come in as props
 * so this doesn't depend on the legacy ThemeCtx.
 */
export type FailedItem = { qid: number; kind: string; name: string; action: 'save' | 'delete'; error?: string };
export type FailedSyncTheme = { ink: string; mid: string; div: string; f700: string; rose700: string };

export function FailedSyncChip({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: '#E8B04A',
        color: '#2A1E08',
        border: 'none',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 11.5,
        fontWeight: 700,
      }}
    >
      ⚠ {count} couldn't sync ›
    </button>
  );
}

export function FailedSyncList({
  items,
  theme: t,
  onRetry,
  onDiscard,
}: {
  items: FailedItem[];
  theme: FailedSyncTheme;
  onRetry: (qid: number) => void;
  onDiscard: (item: FailedItem) => void;
}) {
  if (!items.length) {
    return <div style={{ textAlign: 'center', color: t.mid, fontSize: 14, padding: '12px 0' }}>Everything has synced. Nothing is waiting.</div>;
  }
  const button = (color: string, filled: boolean) => ({
    height: 34,
    padding: '0 14px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    border: filled ? 'none' : `1.5px solid ${t.div}`,
    background: filled ? color : 'transparent',
    color: filled ? '#fff' : color,
  });
  return (
    <>
      <div style={{ fontSize: 13, color: t.mid, lineHeight: 1.5 }}>
        These changes are saved on this device but the server refused them. Nothing has been lost. They retry
        automatically when you sign in or join a group, or you can retry now.
      </div>
      {items.map((item) => (
        <div key={item.qid} style={{ borderTop: `1px solid ${t.div}`, paddingTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.ink }}>
            {item.kind} · {item.name}
            {item.action === 'delete' ? ' (delete)' : ''}
          </div>
          {item.error && <div style={{ fontSize: 12.5, color: t.rose700, marginTop: 3, wordBreak: 'break-word' }}>{item.error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={() => onRetry(item.qid)} style={button(t.f700, true)}>
              Retry
            </button>
            <button onClick={() => onDiscard(item)} style={button(t.rose700, false)}>
              Discard
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
