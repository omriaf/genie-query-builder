import publicConfig from './app-config.json';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { AlertCircle, BarChart2, Copy, Info, Sparkles, TriangleAlert } from 'lucide-react';
import { renderMarkdown } from './markdown';
import { RecommendationCard } from './RecommendationCard';
import type { Recommendation } from './RecommendationCard';
import { ChartRenderer } from './components/ChartRenderer';
import { CostDashboard } from './pages/CostDashboard';
import { parseSseChunk } from './sse';
import { loadHistory, removeFromHistory, saveToHistory } from './lib/history';
import type { HistoryEntry } from './lib/history';
import { getLoadingMessage } from './loading';
import { formatSql } from './lib/formatSql';

const PRESET_QUESTIONS: Record<string, string[]> = Object.fromEntries(publicConfig.customers.map(c => [c.id, c.questions]));
type Column = { name: string; type_name?: string; type_text?: string };
type Feedback = { level: 'info' | 'warning'; title: string; message: string } | null;
type ChartSuggestion = { type: 'line' | 'bar' | 'horizontal_bar' | 'stat' | 'table'; x?: string; y?: string; value?: string; rationale: string };
type AdvisorChart = { type: 'bar' | 'horizontal_bar' | 'line' | 'area' | 'pie' | 'scatter' | 'stat' | 'table'; x: string | null; y: string | null; title: string };
export type QueryResult = { full_answer: string; sql: string | null; columns: Column[]; preview_rows: unknown[][]; chart_suggestion: ChartSuggestion | null; advisor: { chart: AdvisorChart; recommendation: Recommendation } | null; feedback: Feedback };
type Tab = 'answer' | 'sql' | 'preview' | 'chart';

export function autoAggregate(data: Record<string, unknown>[], xCol: string): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const row of data) {
    const value = row[xCol];
    const key = value == null
      ? 'Unknown'
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

function isNumericValue(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
}

export function prepareBarChartData(
  data: Record<string, unknown>[],
  columns: string[],
  advisedX: string | null | undefined,
  advisedY: string | null | undefined,
): { data: Record<string, unknown>[]; xCol: string; yCol: string } | null {
  if (!advisedX || !columns.includes(advisedX)) return null;
  const yIsNumeric = Boolean(advisedY && columns.includes(advisedY) && data.some((row) => isNumericValue(row[advisedY])));
  if (advisedY && yIsNumeric) return { data, xCol: advisedX, yCol: advisedY };
  return { data: autoAggregate(data, advisedX), xCol: 'name', yCol: 'count' };
}

const card: CSSProperties = { background: '#ffffff', borderRadius: 16, boxShadow: '0 2px 12px rgba(100,80,160,0.10)', transition: 'box-shadow 180ms ease' };
const reset: CSSProperties = { font: 'inherit', cursor: 'pointer' };
function displayValue(value: unknown) { if (value == null) return '—'; if (typeof value === 'string') return value; if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString(); return JSON.stringify(value); }
function EmptyState({ message }: { message: string }) { return <div style={{ border: '1px dashed #c4b5fd', borderRadius: 12, color: '#6b7280', minHeight: 180, display: 'grid', placeItems: 'center', background: '#fafafa' }}>{message}</div>; }

export function AdvisorPendingBanner() {
  return <div style={{ background: '#f0edff', border: '1px solid #c4b5fd', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>✨</span>
    <span>AI advisor is analysing the SQL… chart and recommendation incoming</span>
  </div>;
}

function DataTable({ result }: { result: QueryResult }) {
  if (!result.preview_rows.length) return <EmptyState message="No rows returned." />;
  return <div style={{ display: 'grid', gap: 12 }}>
    <div><span style={{ background: '#f0edff', border: '1px solid #c4b5fd', color: '#4f46e5', borderRadius: 999, padding: '5px 11px', fontSize: 12 }}>{result.preview_rows.length} rows · preview</span></div>
    <div style={{ maxHeight: 440, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8f7ff', color: '#4f46e5' }}><tr>{result.columns.map((column) => <th key={column.name} style={{ padding: '13px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid #e5e7eb' }}>{column.name}</th>)}</tr></thead>
      <tbody>{result.preview_rows.map((row, rowIndex) => <tr key={rowIndex} style={{ background: rowIndex % 2 ? '#fafafa' : '#fff' }}>{result.columns.map((column, columnIndex) => <td key={`${rowIndex}-${column.name}`} style={{ padding: '11px 14px', color: '#374151', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{displayValue(row[columnIndex])}</td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}

export default function App() {
  const [page, setPage] = useState<'query' | 'dashboard'>('query');
  const customerId = publicConfig.customers[0]!.id;
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<'genie' | 'enriching' | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const partialResultRef = useRef<QueryResult | null>(null);
  const partialRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('answer');
  const [inputFocused, setInputFocused] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (loadingPhase !== 'genie') return;
    setElapsedSeconds(0);
    const interval = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000);
    return () => clearInterval(interval);
  }, [loadingPhase]);

  useEffect(() => () => {
    if (partialRevealTimerRef.current) clearTimeout(partialRevealTimerRef.current);
  }, []);

  async function askQuestion(nextQuestion: string) {
    const trimmedQuestion = nextQuestion.trim(); if (!trimmedQuestion || loading) return;
    partialResultRef.current = null;
    setQuestion(trimmedQuestion); setLoading(true); setLoadingPhase('genie'); setElapsedSeconds(0); setError(null); setResult(null); setActiveTab('answer');
    try {
      const response = await fetch('/api/genie-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_id: customerId, question: trimmedQuestion }) });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Query failed (${response.status})`);
      }
      if (!response.body) throw new Error('Query response stream is unavailable.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;
      let genieResult: QueryResult | null = null;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
        buffer = parsed.buffer;
        streamDone = parsed.done;
        for (const event of parsed.events) {
          if (event.phase === 'genie') {
            genieResult = { ...(event as QueryResult), advisor: null };
            partialResultRef.current = genieResult;
            setLoadingPhase('enriching');
            partialRevealTimerRef.current = setTimeout(() => {
              setResult(partialResultRef.current);
              setLoading(false);
              partialRevealTimerRef.current = null;
            }, 400);
          } else if (event.phase === 'complete') {
            if (partialRevealTimerRef.current) {
              clearTimeout(partialRevealTimerRef.current);
              partialRevealTimerRef.current = null;
            }
            const completed = genieResult ? { ...genieResult, advisor: event.advisor as QueryResult['advisor'] } : null;
            setResult(completed);
            setLoading(false);
            setLoadingPhase(null);
            if (completed) {
              saveToHistory({ id: crypto.randomUUID(), customer_id: customerId, question: trimmedQuestion, timestamp: Date.now(), result: completed });
              setHistory(loadHistory());
            }
          } else if (event.phase === 'error') {
            throw new Error(typeof event.error === 'string' ? event.error : 'Unable to run this query.');
          }
        }
      }
    }
    catch (requestError) {
      if (partialRevealTimerRef.current) {
        clearTimeout(partialRevealTimerRef.current);
        partialRevealTimerRef.current = null;
      }
      setError(requestError instanceof Error ? requestError.message : 'Unable to run this query.'); setLoadingPhase(null);
    }
    finally { setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void askQuestion(question); }

  async function copy(text: string) { await navigator.clipboard.writeText(text); }
  function restoreHistory(entry: HistoryEntry) {
    setPage('query'); setQuestion(entry.question); setResult(entry.result);
    setActiveTab('answer'); setLoading(false); setLoadingPhase(null); setError(null);
  }
  function deleteHistory(id: string) { removeFromHistory(id); setHistory(loadHistory()); }

  const chartSuggestion = result?.advisor?.chart ?? result?.chart_suggestion;
  const loadingMessage = getLoadingMessage(loadingPhase, elapsedSeconds);
  const chartName = result?.advisor?.chart.title ?? (chartSuggestion ? ({ line: 'Line Chart', area: 'Area Chart', pie: 'Pie Chart', scatter: 'Scatter Plot', bar: 'Bar Chart', horizontal_bar: 'Horizontal Bar', stat: 'KPI Stat', table: 'Table' }[chartSuggestion.type]) : '');
  const formattedSql = useMemo(() => formatSql(result?.sql), [result?.sql]);
  const dashboardSnippet = result && chartSuggestion ? JSON.stringify({ ...(formattedSql && { query: formattedSql }), chart: { type: chartSuggestion.type, ...(chartSuggestion.x && { x: chartSuggestion.x }), ...(chartSuggestion.y && { y: chartSuggestion.y }) } }, null, 2) : '';
  const elevate = (name: string): CSSProperties => ({ ...card, boxShadow: hovered === name ? '0 5px 20px rgba(100,80,160,.16)' : '0 2px 12px rgba(100,80,160,0.10)' });
  const action = (name: string): CSSProperties => ({ ...reset, display: 'inline-flex', alignItems: 'center', gap: 7, background: hovered === name ? '#4f46e5' : '#f0edff', border: '1px solid #c4b5fd', color: hovered === name ? '#fff' : '#4f46e5', borderRadius: 9, padding: '7px 11px' });
  const tabs = [
    ['answer', 'Full Answer'],
    ['sql', 'SQL'],
    ['preview', 'Data Preview'],
    ...(result?.sql ? [['chart', 'Chart']] as const : []),
  ] as const;

  const navStyle = (active: boolean): CSSProperties => ({ ...reset, width: '100%', border: 0, borderRadius: 12, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10, background: active ? '#1a1035' : 'transparent', color: active ? '#fff' : '#6b7280', fontWeight: 700, textAlign: 'left' });
  return <div className="app-shell" style={{ minHeight: '100vh', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden', background: '#ede8f0', color: '#1a1035', fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", display: 'flex', gap: 22, padding: 20 }}>
    <aside className="sidebar" style={{ ...card, width: 240, flex: '0 0 240px', minHeight: 'calc(100vh - 40px)', padding: 18, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ padding: "8px 8px 14px" }}><div style={{ fontSize: 24, fontWeight: 800 }}>Genie Query Builder</div><div style={{ marginTop: 10, color: "#6b7280", fontSize: 12 }}>Ask · Explore · Build</div></div>
      <nav aria-label="Main navigation" style={{ display: 'grid', gap: 7 }}><button type="button" style={navStyle(page === 'query')} onClick={() => setPage('query')}><Sparkles size={18} />Query Builder</button><button type="button" style={navStyle(page === 'dashboard')} onClick={() => setPage('dashboard')}><BarChart2 size={18} />Tracking Calls</button></nav>
      <section aria-label="Recent questions" style={{ display: 'grid', gap: 8, minHeight: 0 }}>
        <div style={{ color: '#9ca3af', fontSize: 11, letterSpacing: '0.08em', fontWeight: 700 }}>RECENT</div>
        {history.length === 0 ? <div style={{ color: '#9ca3af', fontSize: 12 }}>No recent questions yet.</div> : <div style={{ display: 'grid', gap: 3, maxHeight: 260, overflowY: 'auto' }}>{history.slice(0, 7).map((entry) => {
          const historyHover = hovered === `history-${entry.id}`;
          const badge = entry.customer_id === 'retailco' ? { background: '#dcfce7', color: '#166534' } : entry.customer_id === 'logico' ? { background: '#dbeafe', color: '#1e40af' } : { background: '#fef9c3', color: '#854d0e' };
          const customerName = publicConfig.customers.find(c => c.id === entry.customer_id)?.name ?? entry.customer_id;
          return <div key={entry.id} title={new Date(entry.timestamp).toLocaleString()} onMouseEnter={() => setHovered(`history-${entry.id}`)} onMouseLeave={() => setHovered(null)} style={{ display: 'flex', alignItems: 'center', borderRadius: 8, background: historyHover ? '#f5f3ff' : 'transparent', padding: '5px 4px' }}>
            <button type="button" onClick={() => restoreHistory(entry)} style={{ ...reset, minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', padding: 0, textAlign: 'left' }}><span style={{ ...badge, borderRadius: 999, padding: '2px 6px', fontSize: 10, flexShrink: 0 }}>{customerName}</span><span style={{ color: '#374151', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.question}</span></button>
            <button type="button" aria-label={`Remove ${entry.question} from history`} onClick={() => deleteHistory(entry.id)} style={{ ...reset, visibility: historyHover ? 'visible' : 'hidden', border: 0, background: 'transparent', color: '#9ca3af', padding: '0 3px', fontSize: 16 }}>×</button>
          </div>;
        })}</div>}
      </section>
      <div style={{ marginTop: 'auto', padding: 10, color: '#9ca3af', fontSize: 11 }}>Powered by Databricks Genie</div>
    </aside>
    <main id="main-content" className="main-content" style={{ flex: 1, minWidth: 0, maxWidth: 1280, margin: '0 auto', padding: '10px 8px 24px', display: 'grid', alignContent: 'start', gap: 22 }}>
      {page === 'dashboard' ? <CostDashboard /> : <>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}><div><h1 style={{ margin: 0, color: '#1a1035', fontSize: 28 }}>Query Builder</h1><p style={{ margin: '7px 0 0', color: '#6b7280' }}>Ask questions about your ambient IoT data.</p></div><span style={{ color: "#6b7280", fontSize: 13 }}>{publicConfig.customers[0].name}</span></header>
      <section style={{ ...elevate('query'), padding: 28, display: 'grid', gap: 26 }} onMouseEnter={() => setHovered('query')} onMouseLeave={() => setHovered(null)}>
        <div><div style={{ color: '#6b7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 13 }}>Suggested questions</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>{PRESET_QUESTIONS[customerId].map((preset) => <button key={preset} type="button" disabled={loading} onClick={() => void askQuestion(preset)} onMouseEnter={() => setHovered(preset)} onMouseLeave={() => setHovered(null)} style={{ ...reset, background: hovered === preset ? '#4f46e5' : '#f0edff', border: '1px solid #c4b5fd', color: hovered === preset ? '#fff' : '#4f46e5', borderRadius: 8, padding: '8px 12px', fontSize: 13, opacity: loading ? .4 : 1 }}>{preset}</button>)}</div></div>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}><label htmlFor="question" style={{ color: '#374151', fontSize: 14, fontWeight: 650 }}>Ask about your ambient IoT data</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ flex: '1 1 500px', minWidth: 0, background: '#fff', border: `1.5px solid ${inputFocused ? '#4f8ef7' : '#e5e7eb'}`, borderRadius: 12, boxShadow: inputFocused ? '0 0 0 3px rgba(79,142,247,.14)' : 'none' }}><input id="question" placeholder="Ask about assets, coverage, battery health, or temperature" value={question} disabled={loading} onChange={(event) => setQuestion(event.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} style={{ width: '100%', background: 'transparent', color: '#1a1035', border: 0, borderRadius: 12, padding: '13px 15px', outline: 'none', font: 'inherit' }} /></div>
          <button type="submit" disabled={loading || !question.trim()} onMouseEnter={() => setHovered('ask')} onMouseLeave={() => setHovered(null)} style={{ ...reset, border: 0, background: hovered === 'ask' ? '#3b7ee0' : '#4f8ef7', color: '#fff', borderRadius: 10, padding: '12px 26px', fontWeight: 700, minWidth: 104, opacity: loading || !question.trim() ? .4 : 1, cursor: loading || !question.trim() ? 'not-allowed' : 'pointer' }}>{loading ? 'Asking…' : 'Ask'}</button>
        </div></form>
      </section>

      {error && <div role="alert" style={{ display: 'flex', gap: 11, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.4)', color: '#fbbf24', borderRadius: 12, padding: 16, backdropFilter: 'blur(10px)' }}><AlertCircle size={18} /><div><strong>Query failed</strong><div style={{ marginTop: 4, fontSize: 14 }}>{error}</div></div></div>}
      {loading && <section aria-label="Loading query results" style={{ ...card, position: 'relative', padding: 28, overflow: 'hidden' }}><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220, gap: 16 }}><div style={{ width: '100%', height: 3, background: '#ede8f0', borderRadius: 99, overflow: 'hidden', position: 'absolute', top: 0, left: 0 }}><div style={{ height: '100%', width: '40%', background: 'linear-gradient(90deg, transparent, #7c6af7, transparent)', animation: 'slide 1.4s ease-in-out infinite', borderRadius: 99 }} /></div><div key={loadingMessage.icon} style={{ fontSize: 28, animation: 'fadeIn 0.3s ease' }}>{loadingMessage.icon}</div><div key={loadingMessage.title} style={{ fontSize: 15, color: '#4f46e5', fontWeight: 600, animation: 'fadeIn 0.3s ease' }}>{loadingMessage.title}</div><div style={{ fontSize: 13, color: '#9ca3af' }}>{loadingMessage.subtitle}</div></div></section>}
      {result?.feedback && <div style={{ display: 'flex', gap: 11, borderRadius: 12, padding: 16, backdropFilter: 'blur(10px)', background: result.feedback.level === 'warning' ? '#fffbeb' : '#eff6ff', border: `1px solid ${result.feedback.level === 'warning' ? '#f59e0b' : '#93c5fd'}`, color: result.feedback.level === 'warning' ? '#78350f' : '#1e3a5f' }}>{result.feedback.level === 'warning' ? <TriangleAlert size={18} color="#b45309" /> : <Info size={18} />}<div><strong style={{ color: result.feedback.level === 'warning' ? '#b45309' : 'inherit' }}>{result.feedback.title}</strong><div style={{ marginTop: 4, fontSize: 14 }}>{result.feedback.message}</div></div></div>}

      {result && chartSuggestion && <section style={{ ...elevate('results'), padding: 24, overflowX: 'hidden', maxWidth: '100%' }} onMouseEnter={() => setHovered('results')} onMouseLeave={() => setHovered(null)}>
        {!result.advisor && <AdvisorPendingBanner />}
        <div role="tablist" style={{ display: 'flex', gap: 4, background: '#f3f4f6', padding: 4, borderRadius: 12, overflowX: 'auto' }}>{tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeTab === value} onClick={() => setActiveTab(value)} style={{ ...reset, flex: '1 0 auto', border: 0, padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', color: activeTab === value ? '#1a1035' : '#6b7280', background: activeTab === value ? '#fff' : 'transparent', boxShadow: activeTab === value ? '0 2px 8px rgba(26,16,53,.10)' : 'none' }}>{label}{value === 'chart' && loadingPhase === 'enriching' ? ' ⏳' : ''}</button>)}</div>
        <div style={{ paddingTop: 22 }}>
          {activeTab === 'answer' && (result.full_answer ? <div style={{ padding: '20px 24px', background: '#f5f3ff', borderRadius: 12, border: '1px solid #e0d9f7', color: '#1a1035', lineHeight: 1.7 }}>{renderMarkdown(result.full_answer)}</div> : <EmptyState message="Genie returned no text answer." />)}
          {activeTab === 'sql' && (result.sql ? <div style={{ overflowX: 'hidden', overflowY: 'hidden', maxWidth: '100%', boxSizing: 'border-box', borderRadius: 12, background: '#f8f7ff', border: '1px solid #e5e7eb' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}><span>SQL · Databricks</span><button type="button" onClick={() => void copy(formattedSql ?? '')} onMouseEnter={() => setHovered('sql-copy')} onMouseLeave={() => setHovered(null)} style={action('sql-copy')}><Copy size={14} />Copy</button></div><pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'hidden', display: 'block', maxWidth: '100%', boxSizing: 'border-box', wordBreak: 'break-word', overflowWrap: 'anywhere', padding: 22, color: '#1a1035', fontFamily: "'JetBrains Mono','SFMono-Regular',Consolas,monospace", fontSize: 13, lineHeight: 1.7 }}><code style={{ whiteSpace: 'pre-wrap', overflowX: 'hidden', display: 'block', maxWidth: '100%', boxSizing: 'border-box', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{formattedSql}</code></pre><div style={{ borderTop: '1px solid #e5e7eb', padding: '10px 20px', color: '#6b7280', fontSize: 12 }}>AI-generated SQL · Verify before saving to production</div></div> : <EmptyState message="Genie returned no SQL." />)}
          {activeTab === 'preview' && <DataTable result={result} />}
          {activeTab === 'chart' && <div style={{ display: 'grid', gap: 20 }}><div><div style={{ color: '#1a1035', fontWeight: 700 }}>{chartName}</div>{'rationale' in chartSuggestion && <div style={{ color: '#6b7280', fontSize: 13, marginTop: 5 }}>{chartSuggestion.rationale}</div>}</div><div style={{ minWidth: 0, background: '#fff', borderRadius: 12, padding: '18px 8px 2px' }}><ChartRenderer result={result} /></div><div><button type="button" onClick={() => void copy(dashboardSnippet)} onMouseEnter={() => setHovered('dashboard-copy')} onMouseLeave={() => setHovered(null)} style={action('dashboard-copy')}><Copy size={15} />Copy dashboard JSON snippet</button></div></div>}
        </div>
      </section>}
      {result?.advisor?.recommendation && <RecommendationCard recommendation={result.advisor.recommendation} />}
      <footer style={{ textAlign: 'center', fontSize: 12, color: '#475569', padding: '10px 0 2px' }}><Sparkles size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />Powered by Databricks Genie</footer>
      </>}
    </main>
  </div>;
}
