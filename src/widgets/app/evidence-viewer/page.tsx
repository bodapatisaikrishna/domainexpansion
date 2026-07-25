'use client';

export const dynamic = 'force-dynamic';

import { useWidgetSDK } from '@nitrostack/widgets';
import { palette, ErrorBanner, LoadingState, WidgetShell } from '../../components/ui';

interface EvidenceRecord {
  id: string;
  ts: string;
  method: string;
  path: string; // already neutralised: literal "<untrusted field="path">...</untrusted>" text
  query: string | null; // likewise neutralised, or null
  status: number;
  actor: { sub: string | null; role: string | null };
  ip: string;
  latencyMs: number;
  respBytes: number;
  ua: string; // likewise neutralised
}
type ToolResult = { ok: true; data: EvidenceRecord[] } | { ok: false; message: string; nextAction: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
}

function statusColor(status: number): string {
  if (status >= 500) return palette.severity.CRITICAL;
  if (status >= 400) return palette.severity.HIGH;
  if (status >= 300) return palette.severity.MEDIUM;
  return palette.success;
}

/**
 * Renders a neutralise()-wrapped field as literal, inert text — never via
 * dangerouslySetInnerHTML. React already escapes string children by default,
 * so the "<untrusted field=...>" markup the engine produced is visibly
 * printed as text, not interpreted as HTML. That's the actual security
 * property: even a payload that evaded every pattern still reads on screen
 * as quarantined data, not as a live tag.
 */
function UntrustedField({ value }: { value: string | null }) {
  if (value === null) return <span style={{ color: palette.textFaint }}>—</span>;
  return (
    <div
      style={{
        display: 'inline-block',
        fontFamily: palette.mono,
        fontSize: 11,
        color: palette.shadow,
        background: '#1a1408',
        border: `1px dashed ${palette.shadow}`,
        borderRadius: 4,
        padding: '2px 6px',
        maxWidth: '100%',
        overflowWrap: 'anywhere',
      }}
    >
      {value}
    </div>
  );
}

export default function EvidenceViewerWidget() {
  const { isReady, getToolOutput } = useWidgetSDK();
  const result = getToolOutput<ToolResult>();

  if (!isReady || !result) return <WidgetShell><LoadingState label="Loading evidence…" /></WidgetShell>;
  if (!result.ok) return <WidgetShell><ErrorBanner message={result.message} nextAction={result.nextAction} /></WidgetShell>;

  const records = result.data;

  return (
    <WidgetShell>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${palette.border}`, fontSize: 15, fontWeight: 700 }}>
        Evidence ({records.length} record{records.length === 1 ? '' : 's'})
      </div>
      <div style={{ padding: 8 }}>
        {records.length === 0 && <LoadingState label="No evidence records." />}
        {records.map((r) => (
          <div key={r.id} style={{ borderBottom: `1px solid ${palette.border}`, padding: '10px 8px', fontFamily: palette.mono, fontSize: 11 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ color: palette.textFaint }}>{r.id}</span>
              <span style={{ color: palette.textMuted }}>{r.ts}</span>
              <span style={{ color: statusColor(r.status), fontWeight: 700 }}>{r.status}</span>
              <span style={{ color: palette.text }}>{r.method}</span>
              <span style={{ color: palette.accent, fontWeight: 700 }}>{r.actor.sub ?? 'anonymous'}</span>
              {r.actor.role && <span style={{ color: palette.textFaint }}>({r.actor.role})</span>}
              <span style={{ color: palette.textFaint, marginLeft: 'auto' }}>{r.ip} · {r.latencyMs}ms · {formatBytes(r.respBytes)}</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <UntrustedField value={r.path} />
              {r.query !== null && <UntrustedField value={r.query} />}
              <UntrustedField value={r.ua} />
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
