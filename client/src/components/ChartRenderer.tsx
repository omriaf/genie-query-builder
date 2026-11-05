import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';

import type { Recommendation } from '../RecommendationCard';

export type Column = { name: string; type_name?: string; type_text?: string };
export type Feedback = { level: 'info' | 'warning'; title: string; message: string } | null;
export type ChartSuggestion = { type: 'line' | 'bar' | 'horizontal_bar' | 'stacked_bar' | 'stat' | 'table'; x?: string; y?: string; value?: string; rationale: string };
export type AdvisorChart = { type: 'bar' | 'horizontal_bar' | 'stacked_bar' | 'line' | 'area' | 'pie' | 'scatter' | 'stat' | 'table'; x: string | null; y: string | null; title: string };
export type QueryResult = { full_answer: string; sql: string | null; columns: Column[]; preview_rows: unknown[][]; chart_suggestion: ChartSuggestion | null; advisor: { chart: AdvisorChart; recommendation: Recommendation } | null; feedback: Feedback };

const tick = { fill: '#6b7280', fontSize: 12 };
const tooltipStyle = { background: '#fff', border: 0, borderRadius: 10, color: '#1a1035', boxShadow: '0 4px 18px rgba(26,16,53,.12)' };

function displayValue(value: unknown) {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
  return JSON.stringify(value);
}

function chartLabel(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

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

export function aggregateByX(
  rows: Record<string, unknown>[],
  xKey: string,
  yKeys: string[],
): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const xVal = chartLabel(row[xKey]);
    if (!map.has(xVal)) map.set(xVal, { [xKey]: xVal });
    const aggregate = map.get(xVal)!;
    for (const yKey of yKeys) {
      const current = Number(aggregate[yKey] ?? 0);
      const addition = Number(row[yKey] ?? 0);
      aggregate[yKey] = Number.isFinite(current + addition) ? current + addition : current;
    }
  }
  return Array.from(map.values());
}

export function prepareCartesianChartData(
  rows: Record<string, unknown>[],
  primaryXKey: string,
  yKeys: string[],
): { data: Record<string, unknown>[]; xKey: string } {
  let data = rows;
  let xKey = primaryXKey;
  const hasDuplicateX = new Set(data.map((row) => row[xKey])).size < data.length;

  if (hasDuplicateX) {
    const firstRow = rows[0] ?? {};
    const stringColumns = Object.keys(firstRow).filter((key) => {
      const value = firstRow[key];
      return typeof value === 'string' || (typeof value === 'object' && value !== null);
    });
    if (stringColumns.length >= 2) {
      xKey = '__x_composite';
      data = data.map((row) => ({
        ...row,
        [xKey]: `${chartLabel(row[stringColumns[0]])} / ${chartLabel(row[stringColumns[1]])}`,
      }));
    }
  }

  const hasDuplicates = new Set(data.map((row) => row[xKey])).size < data.length;
  return { data: hasDuplicates ? aggregateByX(data, xKey, yKeys) : data, xKey };
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

export function ChartRenderer({ result }: { result: QueryResult }) {
  const chartSuggestion = result.advisor?.chart ?? result.chart_suggestion;
  if (!chartSuggestion) return null;
  const chartData = result.preview_rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])));
  const statColumn = chartSuggestion.type === 'stat'
    ? ('value' in chartSuggestion ? chartSuggestion.value : chartSuggestion.y ?? chartSuggestion.x ?? result.columns[0]?.name)
    : undefined;
  const statColumnIndex = statColumn ? result.columns.findIndex((column) => column.name === statColumn) : -1;
  if (chartSuggestion.type === 'stat') return <div style={{ background: '#f8f7ff', borderRadius: 16, padding: 40, textAlign: 'center' }}><div style={{ color: '#4f46e5', fontSize: 56, fontWeight: 800 }}>{displayValue(result.preview_rows[0]?.[statColumnIndex])}</div><div style={{ color: '#6b7280', fontSize: 13, marginTop: 10 }}>{statColumn}</div></div>;

  const isNumericInData = (column: string) => chartData.length > 0 && isNumericValue(chartData[0][column]);
  const columns = result.columns.map((column) => column.name);
  const resolveX = (advised: string | null | undefined) => {
    if (advised && columns.includes(advised)) return advised;
    const caseInsensitive = columns.find((column) => column.toLowerCase() === (advised ?? '').toLowerCase());
    return caseInsensitive ?? columns.find((column) => !isNumericInData(column)) ?? columns[0] ?? '';
  };
  const resolveY = (advised: string | null | undefined, xColumn: string) => {
    if (advised && columns.includes(advised) && advised !== xColumn) return advised;
    const caseInsensitive = columns.find((column) => column.toLowerCase() === (advised ?? '').toLowerCase() && column !== xColumn);
    return caseInsensitive ?? columns.find((column) => column !== xColumn && isNumericInData(column)) ?? columns.find((column) => column !== xColumn) ?? columns[0] ?? '';
  };
  const xColumn = resolveX(chartSuggestion.x);
  const yColumn = resolveY(chartSuggestion.y, xColumn);
  let barChart = chartSuggestion.type === 'bar' || chartSuggestion.type === 'horizontal_bar' || chartSuggestion.type === 'stacked_bar'
    ? prepareBarChartData(chartData, columns, chartSuggestion.x, chartSuggestion.y)
    : null;
  if (chartSuggestion.type === 'table') {
    const firstStringColumn = result.columns.find((column) => chartData.some((row) => typeof row[column.name] === 'string'))?.name;
    barChart = prepareBarChartData(chartData, columns, firstStringColumn, null);
  }
  if ((chartSuggestion.type === 'bar' || chartSuggestion.type === 'horizontal_bar' || chartSuggestion.type === 'stacked_bar' || chartSuggestion.type === 'table') && !barChart) {
    return <div style={{ color: '#374151', background: '#f5f3ff', border: '1px solid #e0d9f7', borderRadius: 12, padding: '20px 24px' }}>This result shows individual records. Scroll to Data Preview to explore rows, or ask an aggregated question for a chart.</div>;
  }
  const yColumns = columns.filter((column) => column !== xColumn && isNumericInData(column));
  const series = yColumns.length ? yColumns : [yColumn];
  const colors = ['#4f8ef7', '#7c6af7', '#34d399', '#f59e0b'];
  const preparedCartesian = prepareCartesianChartData(chartData, xColumn, series);
  const preparedBar = barChart
    ? prepareCartesianChartData(barChart.data, barChart.xCol, chartSuggestion.type === 'stacked_bar' ? series : [barChart.yCol])
    : null;
  const barData = preparedBar?.data ?? chartData;
  const barXKey = preparedBar?.xKey ?? xColumn;
  const hasLongBarLabels = barData.some((row) => chartLabel(row[barXKey]).length > 10);
  const barXAxisProps = hasLongBarLabels ? { angle: -35, textAnchor: 'end' as const, height: 60 } : {};

  if (chartSuggestion.type === 'horizontal_bar' || chartSuggestion.type === 'table') return <ResponsiveContainer width="100%" height={Math.max(240, barData.length * 44)}><BarChart data={barData} layout="vertical" margin={{ top: 10, right: 40, bottom: 10, left: 120 }}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} /><XAxis type="number" tick={tick} {...barXAxisProps} /><YAxis type="category" dataKey={barXKey} tick={tick} width={110} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey={barChart?.yCol} fill="#4f8ef7" radius={[0, 6, 6, 0]} maxBarSize={28} /></BarChart></ResponsiveContainer>;
  if (chartSuggestion.type === 'line') return <ResponsiveContainer width="100%" height={320}><LineChart data={preparedCartesian.data} margin={{ top: 10, right: 20, bottom: 60, left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey={preparedCartesian.xKey} tick={tick} angle={-35} textAnchor="end" /><YAxis tick={tick} /><Tooltip contentStyle={tooltipStyle} />{series.map((column, index) => <Line key={column} type="monotone" dataKey={column} stroke={colors[index % colors.length]} strokeWidth={3} dot={{ fill: colors[index % colors.length], r: 4 }} />)}</LineChart></ResponsiveContainer>;
  if (chartSuggestion.type === 'area') return <ResponsiveContainer width="100%" height={320}><AreaChart data={preparedCartesian.data}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey={preparedCartesian.xKey} tick={tick} /><YAxis tick={tick} /><Tooltip contentStyle={tooltipStyle} />{series.map((column, index) => <Area key={column} type="monotone" dataKey={column} stroke={colors[index % colors.length]} fill={colors[index % colors.length]} fillOpacity={.22} />)}</AreaChart></ResponsiveContainer>;
  if (chartSuggestion.type === 'pie') return <ResponsiveContainer width="100%" height={340}><PieChart><Tooltip contentStyle={tooltipStyle} /><Pie data={chartData} dataKey={yColumn} nameKey={xColumn} cx="50%" cy="50%" outerRadius={125} label>{chartData.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie></PieChart></ResponsiveContainer>;
  if (chartSuggestion.type === 'scatter') return <ResponsiveContainer width="100%" height={320}><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis type="number" dataKey={xColumn} name={xColumn} tick={tick} /><YAxis type="number" dataKey={yColumn} name={yColumn} tick={tick} /><Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} /><Scatter data={chartData} fill="#4f8ef7" /></ScatterChart></ResponsiveContainer>;
  return <ResponsiveContainer width="100%" height={320}><BarChart data={barData} margin={{ top: 10, right: 20, bottom: 60, left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" /><XAxis dataKey={barXKey} tick={tick} {...barXAxisProps} /><YAxis tick={tick} /><Tooltip contentStyle={tooltipStyle} />{chartSuggestion.type === 'stacked_bar' ? series.map((column, index) => <Bar key={column} dataKey={column} stackId="stack" fill={colors[index % colors.length]} maxBarSize={60} />) : <Bar dataKey={barChart?.yCol ?? yColumn} fill="#4f8ef7" radius={[6, 6, 0, 0]} maxBarSize={60} />}</BarChart></ResponsiveContainer>;
}
