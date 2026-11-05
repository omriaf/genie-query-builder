import type { QueryResult } from '../App';

export type HistoryEntry = {
  id: string;
  customer_id: string;
  question: string;
  timestamp: number;
  result: QueryResult;
};

const KEY = 'wqb_history';
const MAX_ENTRIES = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

export function saveToHistory(entry: HistoryEntry): void {
  const existing = loadHistory().filter((item) => item.id !== entry.id);
  localStorage.setItem(KEY, JSON.stringify([entry, ...existing].slice(0, MAX_ENTRIES)));
}

export function removeFromHistory(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((item) => item.id !== id)));
}

export function clearHistory(): void {
  localStorage.removeItem(KEY);
}
