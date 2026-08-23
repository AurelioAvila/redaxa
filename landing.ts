function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Redaxa landing element missing: ${selector}`);
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
  const scanButton = required<HTMLButtonElement>("#scan");

  const scan = async (): Promise<void> => {
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
    const originalLabel = scanButton.textContent;
    scanButton.disabled = true;
    scanButton.textContent = "Checking…";
    try {
      const { findings: matches, redactedText } = await window.promptShieldAuth.scanPrompt(text, { includePersonalData: true, includeCredentials: true, includeFinancialData: true });
      resultTitle.textContent = matches.length ? `${matches.length} item${matches.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
      resultCopy.textContent = matches.length ? "Review these details before you share the prompt." : "This is a helpful signal, not a guarantee. Always review before sharing.";
      findings.className = "";
      findings.innerHTML = matches.length
        ? matches.map((item) => `<div class="finding"><i class="severity"></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span></div></div>`).join("")
        : `<div class="empty">No common secrets or personal details were detected in this check.</div>`;
      redacted.textContent = redactedText;
      output.style.display = "block";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
        window.promptShieldAuth?.requestAccess("Start your 7-day free trial to inspect prompts.");
      } else {
        resultTitle.textContent = "Check failed";
        resultCopy.textContent = "We could not run that check. Please try again.";
      }
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = originalLabel;
    }
  };

  scanButton.addEventListener("click", () => { void scan(); });
  required<HTMLButtonElement>("#sample").addEventListener("click", () => {
    prompt.value = "Write a concise project update to maria.rossi@example.com. Mention that the staging server is at 192.168.1.20 and include this demo credential: password=demo-secret-credential-123.";
    void scan();
  });
  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    const button = required<HTMLButtonElement>("#copy");
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = "Copy safer prompt"; }, 1400);
  });
  document.addEventListener("redaxa:need-upgrade", () => {
    location.hash = "#pricing";
    document.querySelector("#pricing")?.scrollIntoView({ behavior: "smooth" });
  });
}

if (typeof document !== "undefined") mountLanding();
