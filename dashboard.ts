import { inspectPrompt, type Finding } from "./scanner.js";

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

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`PromptShield dashboard element missing: ${selector}`);
  return element;
}

export function mountDashboard(): void {
  const prompt = required<HTMLTextAreaElement>("#prompt");
  const findingsRoot = required<HTMLElement>("#findings");
  const safeRoot = required<HTMLElement>("#safe");
  const redacted = required<HTMLElement>("#redacted");
  const count = required<HTMLElement>("#risk-count");
  const title = required<HTMLElement>("#risk-title");
  const copy = required<HTMLElement>("#risk-copy");
  const historyRoot = required<HTMLElement>("#history");

  const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;"
  }[character] ?? character));

  const renderHistory = (): void => {
    const history = readHistory();
    historyRoot.innerHTML = history.length ? history.map((entry) => `<article class="entry"><strong>${entry.findings} item${entry.findings === 1 ? "" : "s"} reviewed</strong><span>${escapeHtml(entry.preview)}</span><em>${new Date(entry.createdAt).toLocaleString()}</em></article>`).join("") : `<div class="entry"><strong>No checks yet</strong><span>Your last eight check summaries will appear here.</span></div>`;
  };

  const scan = (): void => {
    if (!prompt.value.trim()) return;
    const result = inspectAndStore(prompt.value);
    count.textContent = String(result.findings.length);
    title.textContent = result.findings.length ? `${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
    copy.textContent = result.findings.length ? "Review these before sharing your prompt." : "This is a helpful signal, not a guarantee.";
    findingsRoot.className = "findings";
    findingsRoot.innerHTML = result.findings.length ? result.findings.map((finding) => `<div class="finding"><i></i><div><b>${finding.label}</b><span>${escapeHtml(finding.value)}</span></div></div>`).join("") : `<div class="empty">No common secrets or personal details were detected.</div>`;
    redacted.textContent = result.redactedText;
    safeRoot.style.display = "block";
    renderHistory();
  };

  required<HTMLButtonElement>("#scan").addEventListener("click", scan);
  required<HTMLButtonElement>("#sample").addEventListener("click", () => {
    prompt.value = "Send a project update to maria.rossi@example.com. The test server is 192.168.1.20 and the temporary credential is DEMO_TOKEN_PLACEHOLDER.";
    scan();
  });
  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    const button = required<HTMLButtonElement>("#copy");
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy safer prompt"; }, 1400);
  });
  renderHistory();
}

if (typeof document !== "undefined") mountDashboard();
