import { inspectPrompt } from "./scanner.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`PromptShield landing element missing: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" }[character] ?? character));
}

function mountLanding(): void {
  const prompt = required<HTMLTextAreaElement>("#prompt");
  const findings = required<HTMLElement>("#findings");
  const output = required<HTMLElement>("#safe-output");
  const redacted = required<HTMLElement>("#redacted");
  const resultTitle = required<HTMLElement>("#result-title");
  const resultCopy = required<HTMLElement>("#result-copy");

  const scan = (): void => {
    const text = prompt.value;
    if (!text.trim()) {
      resultTitle.textContent = "Add a prompt first";
      resultCopy.textContent = "Nothing was scanned.";
      findings.className = "empty";
      findings.textContent = "Paste text on the left, then run a private check.";
      output.style.display = "none";
      return;
    }
    if (!window.promptShieldAuth?.hasAccess()) {
      window.promptShieldAuth?.requestAccess("Create your account and start your 7-day free trial to inspect prompts.");
      return;
    }
    const { findings: matches, redactedText } = inspectPrompt(text, { includePersonalData: true, includeCredentials: true, includeFinancialData: true });
    resultTitle.textContent = matches.length ? `${matches.length} item${matches.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
    resultCopy.textContent = matches.length ? "Review these details before you share the prompt." : "This is a helpful signal, not a guarantee. Always review before sharing.";
    findings.className = "";
    findings.innerHTML = matches.length
      ? matches.map((item) => `<div class="finding"><i class="severity"></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span></div></div>`).join("")
      : `<div class="empty">No common secrets or personal details were detected in this check.</div>`;
    redacted.textContent = redactedText;
    output.style.display = "block";
  };

  required<HTMLButtonElement>("#scan").addEventListener("click", scan);
  required<HTMLButtonElement>("#sample").addEventListener("click", () => {
    prompt.value = "Write a concise project update to maria.rossi@example.com. Mention that the staging server is at 192.168.1.20 and include this demo credential: password=demo-secret-credential-123.";
    scan();
  });
  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    const button = required<HTMLButtonElement>("#copy");
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy safer prompt"; }, 1400);
  });
  document.addEventListener("promptshield:need-upgrade", () => {
    location.hash = "#pricing";
    document.querySelector("#pricing")?.scrollIntoView({ behavior: "smooth" });
  });
}

if (typeof document !== "undefined") mountLanding();
