import type { ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return parts.flatMap((part, partIndex) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex} style={{ color: '#1a1035', fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={partIndex}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={partIndex} style={{ background: 'rgba(139,97,255,0.2)', borderRadius: 4, padding: '1px 5px', fontSize: '0.9em' }}>{part.slice(1, -1)}</code>;
    return part.split('\n').flatMap((line, lineIndex) => lineIndex === 0 ? line : [<br key={`${partIndex}-${lineIndex}`} />, line]);
  });
}

export function renderMarkdown(text: string): ReactNode[] {
  return text.split(/\n\n+/).map((paragraph, paragraphIndex) => {
    const lines = paragraph.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return <ul key={paragraphIndex} style={{ margin: '0 0 12px', paddingLeft: 24, lineHeight: 1.7, color: '#374151' }}>{lines.map((line, lineIndex) => <li key={lineIndex} style={{ color: '#374151' }}>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={paragraphIndex} style={{ marginBottom: 12, lineHeight: 1.7, color: '#374151' }}>{renderInline(paragraph)}</p>;
  });
}
