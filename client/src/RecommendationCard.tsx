import { CheckCircle2, Copy, Lightbulb, TriangleAlert, Zap } from 'lucide-react';

export type Recommendation = {
  type: 'suggest_metric_view' | 'suggest_gold_view' | 'missing_data' | 'contact_admin' | 'optimised' | null;
  severity: 'success' | 'info' | 'warning';
  message: string;
  yaml_snippet: string | null;
};

export function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  if (!recommendation.type) return null;
  const presentation = {
    optimised: { Icon: CheckCircle2, background: '#dcfce7', color: '#166534', label: 'Query is optimised — uses a Metric View' },
    suggest_metric_view: { Icon: Zap, background: '#fef9c3', color: '#854d0e', label: recommendation.message },
    suggest_gold_view: { Icon: Lightbulb, background: '#dbeafe', color: '#1e40af', label: recommendation.message },
    missing_data: { Icon: TriangleAlert, background: '#fee2e2', color: '#991b1b', label: recommendation.message },
    contact_admin: { Icon: TriangleAlert, background: '#fee2e2', color: '#991b1b', label: recommendation.message },
  }[recommendation.type];
  const { Icon, background, color, label } = presentation;
  const copy = () => recommendation.yaml_snippet && navigator.clipboard.writeText(recommendation.yaml_snippet);

  return <section style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(100,80,160,0.10)', display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', flexWrap: 'wrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background, color, borderRadius: 999, padding: '6px 10px', fontWeight: 700 }}><Icon size={17} />{recommendation.type.replaceAll('_', ' ')}</span><div style={{ color: '#374151', lineHeight: 1.6, paddingTop: 4 }}>{label}</div></div>
    {recommendation.yaml_snippet && <div style={{ display: 'grid', gap: 10 }}>
      <pre style={{ margin: 0, overflowX: 'auto', padding: 16, borderRadius: 10, background: '#f8f7ff', border: '1px solid #e5e7eb', color: '#1a1035', fontSize: 12 }}><code>{recommendation.yaml_snippet}</code></pre>
      <button type="button" onClick={() => void copy()} style={{ width: 'fit-content', display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', background: '#f0edff', border: '1px solid #c4b5fd', color: '#4f46e5', borderRadius: 9, padding: '8px 12px', font: 'inherit' }}><Copy size={14} />Copy YAML</button>
    </div>}
  </section>;
}
