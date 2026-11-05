import publicConfig from '../app-config.json';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Clock3, DollarSign, RefreshCw, Star, TrendingUp, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type CostStats = {
  kpis: { total_queries_today: number; total_cost_week_usd: number; avg_cost_per_query_usd: number; most_active_customer: string };
  by_customer: Array<{ customer_id: string; count: number; fmapi_cost_usd: number; genie_cost_est_usd: number }>;
  by_day: Array<{ day: string; count: number; fmapi_cost_usd: number; genie_cost_est_usd: number }>;
  by_user: Array<{ user_email: string; count: number; cost_usd: number }>;
  recent: Array<{ ts: string; customer_id: string; question_preview: string; fmapi_input_tokens: number; fmapi_output_tokens: number; fmapi_cost_usd: number; genie_cost_est_usd: number | null; has_sql: boolean; rec_type: string; duration_ms: number; sql_execution_ms: number; genie_ms: number; answer_length: number; conversation_id: string; user_email: string }>;
};

const card = { background: '#ffffff', borderRadius: 16, boxShadow: '0 2px 12px rgba(100,80,160,0.10)' } as const;
const tick = { fill: '#6b7280', fontSize: 12 };
const money = (value: number) => `$${value.toFixed(4)}`;
const formatDuration = (value: number) => value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${value.toLocaleString()} ms`;
const userName = (email: string) => email.split('@')[0] || 'unknown';
const cell = { padding: '13px 14px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' } as const;
const recommendationColors: Record<string, { background: string; color: string }> = {
  optimised: { background: '#dcfce7', color: '#166534' },
  suggest_metric_view: { background: '#fef3c7', color: '#92400e' },
  missing_data: { background: '#fee2e2', color: '#991b1b' },
  contact_admin: { background: '#ffedd5', color: '#9a3412' },
};

export const getCostStatsUrl = (tz: string) => `/api/cost-stats?tz=${encodeURIComponent(tz)}`;

function DetailCard({ type, row }: { type: 'genie' | 'advisor'; row: CostStats['recent'][number] }) {
  const isGenie = type === 'genie';
  const details = isGenie
    ? [
        ['Processing time', formatDuration(row.genie_ms)],
        ['SQL generated', row.has_sql ? 'Yes' : 'No'],
        ['Answer length', `${row.answer_length.toLocaleString()} chars`],
        ['Conversation ID', row.conversation_id ? `${row.conversation_id.slice(0, 8)}…` : '—'],
        ['DBU usage', 'Not available from Genie API'],
        ['Cost', 'Not available'],
      ]
    : [
        ['Cost', money(row.fmapi_cost_usd)],
        ['Model', publicConfig.advisor_endpoint],
        ['Input Tokens', row.fmapi_input_tokens.toLocaleString()],
        ['Output Tokens', row.fmapi_output_tokens.toLocaleString()],
      ];
  return <article style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 18px', minWidth: 0 }}>
    <h3 style={{ margin: '0 0 12px', color: '#1a1035', fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>{isGenie ? 'Genie NL→SQL' : 'AI Advisor'}{isGenie ? null : <span style={{ background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>estimate</span>}</h3>
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) auto', gap: '7px 18px', fontSize: 12 }}>
      {details.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt style={{ color: '#6b7280' }}>{label}</dt><dd style={{ margin: 0, color: '#1a1035', fontWeight: 700, textAlign: 'right' }}>{value}</dd></div>)}
    </dl>
    <p style={{ margin: '12px 0 0', color: '#6b7280', fontSize: 11, lineHeight: 1.45, fontStyle: 'italic' }}>{isGenie ? 'Genie tokens, DBUs and costs are not inferred. Consult workspace billing for available usage.' : `Estimate using configured rates: $${publicConfig.advisor_input_usd_per_million}/million input tokens and $${publicConfig.advisor_output_usd_per_million}/million output tokens. Tokens come from the endpoint response. This excludes SQL warehouse and app compute; reconcile with your billing records.`}</p>
  </article>;
}

function KpiCard({ label, value, color, Icon }: { label: string; value: string; color: string; Icon: typeof Clock3 }) {
  return <article style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 15, minWidth: 0 }}>
    <div style={{ width: 46, height: 46, flex: '0 0 46px', display: 'grid', placeItems: 'center', borderRadius: 14, background: color }}><Icon size={21} color="#fff" /></div>
    <div style={{ minWidth: 0 }}><div style={{ color: '#1a1035', fontSize: 24, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div><div style={{ color: '#6b7280', fontSize: 13, marginTop: 3 }}>{label}</div></div>
  </article>;
}

function EmptyChart() {
  return <div style={{ height: 280, display: 'grid', placeItems: 'center', color: '#9ca3af' }}>No cost data yet.</div>;
}

export function CostDashboardContent({ stats }: { stats: CostStats }) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleRow(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const tooltip = { background: '#fff', border: 0, borderRadius: 10, boxShadow: '0 4px 18px rgba(26,16,53,.12)', color: '#1a1035' };
  return <div style={{ display: 'grid', gap: 20 }}>
    <p style={{margin:0,color:'#374151'}}>Usage tracking covers completed questions and advisor token responses. Costs are advisor-only estimates; Genie, SQL warehouse and app compute billing are excluded. {publicConfig.advisor_input_usd_per_million === 0 && publicConfig.advisor_output_usd_per_million === 0 ? 'Pricing is not configured: cost figures remain zero until rates are supplied.' : ''}</p>
    <section className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
      <KpiCard label="Total Today" value={String(stats.kpis.total_queries_today)} color="#4f8ef7" Icon={Clock3} />
      <KpiCard label="Advisor estimate 7 Days" value={money(stats.kpis.total_cost_week_usd)} color="#34d399" Icon={DollarSign} />
      <KpiCard label="Avg advisor estimate" value={money(stats.kpis.avg_cost_per_query_usd)} color="#7c6af7" Icon={TrendingUp} />
      <KpiCard label="Top Customer" value={stats.kpis.most_active_customer || '—'} color="#f59e0b" Icon={Star} />
      <KpiCard label="Active Users" value={String(stats.by_user.length)} color="#8b5cf6" Icon={Users} />
    </section>
    <section className="chart-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
      <article style={{ ...card, padding: 22, minWidth: 300, flex: 1 }}><h2 style={{ margin: '0 0 10px', color: '#1a1035', fontSize: 17 }}>Advisor cost over time <span style={{ color: '#9ca3af', fontWeight: 500, fontSize: 12 }}>(14 days)</span></h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4f8ef7', display: 'inline-block' }} />Advisor</span>
        </div>
        {stats.by_day.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={stats.by_day}><CartesianGrid stroke="#f3f4f6" vertical={false} /><XAxis dataKey="day" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltip} formatter={(value) => money(Number(value))} /><Bar dataKey="fmapi_cost_usd" stackId="cost" fill="#4f8ef7" name="Advisor (est. $)" radius={[7, 7, 0, 0]} maxBarSize={58} /></BarChart></ResponsiveContainer> : <EmptyChart />}
      </article>
      <article style={{ ...card, padding: 22, minWidth: 300, flex: 1 }}><h2 style={{ margin: '0 0 10px', color: '#1a1035', fontSize: 17 }}>Advisor cost by customer</h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#4f8ef7', display: 'inline-block' }} />Advisor</span>
        </div>
        {stats.by_customer.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={stats.by_customer}><CartesianGrid stroke="#f3f4f6" vertical={false} /><XAxis dataKey="customer_id" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltip} formatter={(value) => money(Number(value))} /><Bar dataKey="fmapi_cost_usd" stackId="cost" fill="#4f8ef7" name="Advisor (est. $)" radius={[7, 7, 0, 0]} maxBarSize={58} /></BarChart></ResponsiveContainer> : <EmptyChart />}
      </article>
      <article style={{ ...card, boxShadow: '0 2px 12px rgba(17,24,39,0.10)', padding: 22, minWidth: 300, flex: 1 }}><h2 style={{ margin: '0 0 10px', color: '#1a1035', fontSize: 17 }}>Queries by user (30 days)</h2>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981', display: 'inline-block' }} />Queries</span>
        </div>
        {stats.by_user.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={stats.by_user}><CartesianGrid stroke="#f3f4f6" vertical={false} /><XAxis dataKey="user_email" tick={tick} tickFormatter={userName} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} /><Tooltip contentStyle={tooltip} /><Bar dataKey="count" fill="#10b981" name="Queries" radius={[7, 7, 0, 0]} maxBarSize={58} /></BarChart></ResponsiveContainer> : <EmptyChart />}
      </article>
    </section>
    <section style={{ ...card, overflow: 'hidden' }}><div style={{ padding: '22px 22px 16px' }}><h2 style={{ margin: 0, color: '#1a1035', fontSize: 17 }}>Recent queries</h2></div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr style={{ background: '#f8f7ff', color: '#4f46e5' }}><th aria-label="Expand details" style={{ width: 28, padding: '12px 0 12px 14px', borderBottom: '1px solid #e5e7eb' }} />{['Time', 'Question', 'Customer', 'User', 'Total Time', 'Query Time', 'Recommendation', 'Genie (est. $)', 'Advisor (est. $)'].map((heading) => {
        const titles: Record<string, string> = {
          'Total Time': 'Full round-trip including Genie AI reasoning and advisor enrichment',
          'Query Time': 'Time for the warehouse to execute the saved SQL query',
          Recommendation: 'Recommendation Type',
        };
        return <th key={heading} title={titles[heading]} style={{ padding: '12px 14px', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #e5e7eb' }}>{heading}</th>;
      })}</tr></thead>
        <tbody>{stats.recent.length ? stats.recent.map((row, index) => {
          const expanded = expandedRows.has(row.ts);
          const recommendationColor = recommendationColors[row.rec_type] ?? { background: '#f3f4f6', color: '#6b7280' };
          return <Fragment key={row.ts}>
            <tr onClick={() => toggleRow(row.ts)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleRow(row.ts); } }} tabIndex={0} aria-expanded={expanded} style={{ background: index % 2 ? '#fafafa' : '#fff', color: '#374151', cursor: 'pointer' }}>
              <td style={{ ...cell, paddingRight: 0, color: '#6b7280', fontSize: 10 }}>{expanded ? '▼' : '▶'}</td>
              <td style={cell}>{new Date(row.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
              <td title={row.question_preview} style={{ ...cell, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.question_preview}</td>
              <td style={cell}>{row.customer_id}</td>
              <td style={cell}><span title={row.user_email} style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 999, padding: '3px 8px', fontSize: 12 }}>{userName(row.user_email)}</span></td>
              <td style={cell}>{formatDuration(row.duration_ms)}</td>
              <td style={cell}>{formatDuration(row.sql_execution_ms)}</td>
              <td style={cell}><span style={{ ...recommendationColor, borderRadius: 999, padding: '4px 9px', fontWeight: 700 }}>{row.rec_type || '—'}</span></td>
              <td style={{ ...cell, fontFamily: 'ui-monospace,SFMono-Regular,monospace' }}>{'Unavailable'}</td>
              <td style={{ ...cell, fontFamily: 'ui-monospace,SFMono-Regular,monospace' }}>{money(row.fmapi_cost_usd)}</td>
            </tr>
            <tr><td colSpan={10} style={{ padding: 0, border: 0 }}><div style={{ maxHeight: expanded ? 400 : 0, overflow: 'hidden', transition: 'max-height 240ms ease' }}><div style={{ background: '#f8f7ff', borderTop: '1px solid #e0d9f7', padding: '16px 22px 16px 48px', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(260px,1fr))', gap: 14 }}><DetailCard type="genie" row={row} /><DetailCard type="advisor" row={row} /></div></div></td></tr>
          </Fragment>;
        }) : <tr><td colSpan={10} style={{ padding: 30, textAlign: 'center', color: '#6b7280' }}>No query costs have been logged yet.</td></tr>}</tbody>
      </table></div>
    </section>
  </div>;
}

export function CostDashboard() {
  const [stats, setStats] = useState<CostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(getCostStatsUrl(tz));
      const payload = await response.json() as CostStats & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Unable to load costs (${response.status})`);
      setStats(payload);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load cost statistics.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <div style={{ display: 'grid', gap: 20 }}><header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}><div><h1 style={{ margin: 0, color: '#1a1035', fontSize: 28 }}>Dashboard</h1><p style={{ margin: '7px 0 0', color: '#6b7280' }}>FMAPI usage and query activity across customers.</p></div><button type="button" onClick={() => void refresh()} disabled={loading} style={{ border: 0, borderRadius: 10, background: '#4f8ef7', color: '#fff', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit', fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}><RefreshCw size={16} />Refresh</button></header>
    {loading && !stats ? <div aria-label="Loading cost statistics" style={{ ...card, padding: 24, display: 'grid', gap: 13 }}>{[42, 100, 86, 100, 72].map((width, index) => <div key={index} className="skeleton" style={{ height: index > 2 ? 70 : 18, width: `${width}%`, borderRadius: 8 }} />)}</div> : null}
    {error ? <div role="alert" style={{ ...card, padding: 18, color: '#991b1b', background: '#fee2e2' }}>{error}</div> : null}
    {stats ? <CostDashboardContent stats={stats} /> : null}
  </div>;
}
