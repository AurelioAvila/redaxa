import { inspectPrompt, type Finding } from "./scanner";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string };

const storageKey = "promptshield.personal-history.v1";

export function saveHistory(text: string, findings: Finding[]): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    findings: findings.length,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 76)
  };
  const history = [entry, ...readHistory()].slice(0, 8);
  localStorage.setItem(storageKey, JSON.stringify(history));
  return history;
}

export function readHistory(): HistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value as HistoryEntry[] : [];
  } catch { return []; }
}

export function inspectAndStore(text: string) {
  const result = inspectPrompt(text);
  return { ...result, history: saveHistory(text, result.findings) };
}
