'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useWidgetSDK } from '@nitrostack/widgets';
import { palette, StatTile, ErrorBanner, LoadingState, WidgetShell } from '../../components/ui';

interface IngestData {
  counts: number;
  timeRange: { from: string; to: string };
  distinctActors: number;
  templatesDiscovered: number;
  rejected: { count: number; reasons: string[] };
}
type IngestResult = { ok: true; data: IngestData } | { ok: false; message: string; nextAction: string };
type ShadowResult = { ok: true; data: { shadow: unknown[] } };
type ScanResult = { ok: true; data: { severity: string }[] };

export default function SurfaceScorecardWidget() {
  const { isReady, getToolOutput, callTool } = useWidgetSDK();
  const result = getToolOutput<IngestResult>();

  // list_shadow_endpoints and scan_authorization_risks aren't part of
  // ingest_access_logs' own output — this widget calls them itself on mount
  // to fill in the other two numbers, since the tool it's bound to can't
  // know shadow/critical counts before a spec is even imported.
  const [shadowCount, setShadowCount] = useState<number | null>(null);
  const [criticalCount, setCriticalCount] = useState<number | null>(null);

  useEffect(() => {
    if (!result?.ok) return;
    let cancelled = false;

    callTool('list_shadow_endpoints', {})
      .then((res) => {
        if (cancelled) return;
        const parsed: ShadowResult = JSON.parse(res.result);
        setShadowCount(parsed.ok ? parsed.data.shadow.length : 0);
      })
      .catch(() => !cancelled && setShadowCount(0));

    callTool('scan_authorization_risks', { minSeverity: 'CRITICAL' })
      .then((res) => {
        if (cancelled) return;
        const parsed: ScanResult = JSON.parse(res.result);
        setCriticalCount(parsed.ok ? parsed.data.length : 0);
      })
      .catch(() => !cancelled && setCriticalCount(0));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.ok]);

  if (!isReady || !result) return <WidgetShell><LoadingState label="Ingesting access logs…" /></WidgetShell>;
  if (!result.ok) return <WidgetShell><ErrorBanner message={result.message} nextAction={result.nextAction} /></WidgetShell>;

  const { data } = result;

  return (
    <WidgetShell>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Access-Log Ingestion Complete</div>
        <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 14 }}>
          {data.timeRange.from} → {data.timeRange.to}
          {data.rejected.count > 0 && <span style={{ color: palette.severity.HIGH }}> · {data.rejected.count} record(s) rejected</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatTile label="Endpoints Observed" value={data.templatesDiscovered} />
          <StatTile label="Shadow Endpoints" value={shadowCount ?? '…'} accent={palette.shadow} />
          <StatTile label="Critical Findings" value={criticalCount ?? '…'} accent={palette.severity.CRITICAL} />
          <StatTile label="Actors Seen" value={data.distinctActors} accent={palette.accent} />
        </div>
      </div>
    </WidgetShell>
  );
}
