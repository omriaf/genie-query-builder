import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHistory, loadHistory, removeFromHistory, saveToHistory } from './history';
import type { HistoryEntry } from './history';

const result = {
  full_answer: 'Answer',
  sql: 'SELECT 1',
  columns: [],
  preview_rows: [],
  chart_suggestion: null,
  advisor: null,
  feedback: null,
};

function entry(id: string, timestamp: number): HistoryEntry {
  return { id, customer_id: 'retailco', question: `Question ${id}`, timestamp, result };
}

describe('question history', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('loads an empty list when storage is empty or malformed', () => {
    expect(loadHistory()).toEqual([]);
    values.set('wqb_history', '{bad json');
    expect(loadHistory()).toEqual([]);
  });

  it('saves newest entries first, replaces duplicate ids, and caps history at 20', () => {
    for (let index = 0; index < 22; index += 1) saveToHistory(entry(String(index), index));
    saveToHistory({ ...entry('21', 100), question: 'Updated question' });

    const history = loadHistory();
    expect(history).toHaveLength(20);
    expect(history[0]).toMatchObject({ id: '21', question: 'Updated question' });
    expect(history.filter((item) => item.id === '21')).toHaveLength(1);
    expect(history.at(-1)?.id).toBe('2');
  });

  it('removes one entry and clears all history', () => {
    saveToHistory(entry('one', 1));
    saveToHistory(entry('two', 2));
    removeFromHistory('one');
    expect(loadHistory().map((item) => item.id)).toEqual(['two']);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});
