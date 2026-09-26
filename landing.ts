import { track } from './growth.js';

const demoPrompt = 'Write a concise project update to maria.rossi@example.com. Mention that the staging server is at 192.168.1.20 and include this demo credential: password=demo-secret-credential-123.';

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Redaxa landing element missing: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" }[character] ?? character));
}

function mountLanding(): void {
  const billingButtons = document.querySelectorAll<HTMLButtonElement>('[data-billing]');
  billingButtons.forEach(button => button.addEventListener('click', () => {
    const yearly = button.dataset.billing === 'yearly';
    billingButtons.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    required('#pro-plan-price').innerHTML = yearly ? '€79.90 <small>/ year</small>' : '€7.99 <small>/ month</small>';
    required('#business-plan-price').innerHTML = yearly ? '€149.90 <small>/ user / year</small>' : '€14.99 <small>/ user / month</small>';
    required('#pro-plan-tag').textContent = yearly ? 'Recommended · Pro yearly' : 'Your everyday privacy toolkit';
    document.querySelectorAll<HTMLElement>('[data-plan]').forEach(cta => { cta.dataset.interval = yearly ? 'yearly' : 'monthly'; });
  }));
  const prompt = required<HTMLTextAreaElement>("#prompt");
  const findings = required<HTMLElement>("#findings");
  const output = required<HTMLElement>("#safe-output");
  const redacted = required<HTMLElement>("#redacted");
  const resultTitle = required<HTMLElement>("#result-title");
  const resultCopy = required<HTMLElement>("#result-copy");
  const scanButton = required<HTMLButtonElement>("#scan");

  let isDemo = false;
  const showDemo = (): void => {
    isDemo = true;
    prompt.value = demoPrompt;
    resultTitle.textContent = '3 example details to review';
    resultCopy.textContent = 'Illustrative demo with fictional data, answered without a scan. Replace it with your own text to run a real check.';
    findings.className = '';
    findings.innerHTML = '<div class="finding"><i class="severity"></i><div><b>Email</b><span>maria.rossi@example.com → [email]</span></div></div><div class="finding"><i class="severity"></i><div><b>Server address</b><span>192.168.1.20 → [ip]</span></div></div><div class="finding"><i class="severity"></i><div><b>Demo credential</b><span>password=demo-secret-credential-123 → [credential]</span></div></div>';
    redacted.textContent = 'Write a concise project update to [email]. Mention that the staging server is at [ip] and include this demo credential: [credential].';
    output.style.display = 'block';
    track('demo_result');
  };
  prompt.addEventListener('input', () => {
    isDemo = false;
    output.style.display = 'none';
    findings.textContent = 'Your text has changed. Run a check to inspect it.';
    resultTitle.textContent = 'Ready for your text';
    resultCopy.textContent = 'Paste your own text and run a real check. The first few each day need no account.';
  });
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
    if (text === demoPrompt) { showDemo(); return; }
    // No client-side gate any more: the server grants a visitor a few real
    // scans a day before it asks for anything (anonymousDailyScans in
    // api/scan.ts). Checking hasAccess() here meant the first genuine thing
    // a visitor tried to scan bounced off a signup dialog, which is the one
    // moment the product could have proved itself. When the quota is spent
    // the server answers TRIAL_REQUIRED and the catch below opens the same
    // dialog, at the point where it has been earned.
    // The auth bundle owns the fetch wrapper even for an anonymous scan. If
    // it never loaded, say so rather than failing silently on the click.
    const auth = window.promptShieldAuth;
    if (!auth) {
      resultTitle.textContent = "Check failed";
      resultCopy.textContent = "We could not run that check. Please reload the page and try again.";
      return;
    }
    const originalLabel = scanButton.textContent;
    scanButton.disabled = true;
    scanButton.textContent = "Checking…";
    try {
      const { findings: matches, redactedText } = await auth.scanPrompt(text, { includePersonalData: true, includeCredentials: true, includeFinancialData: true });
      resultTitle.textContent = matches.length ? `${matches.length} item${matches.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
      resultCopy.textContent = matches.length ? "Review these details before you share the prompt." : "This is a helpful signal, not a guarantee. Always review before sharing.";
      findings.className = "";
      findings.innerHTML = matches.length
        ? matches.map((item) => `<div class="finding"><i class="severity"></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span></div></div>`).join("")
        : `<div class="empty">No common secrets or personal details were detected in this check.</div>`;
      isDemo = false;
      track('scan_success');
      redacted.textContent = redactedText;
      output.style.display = "block";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
        track('trial_gate');
        auth.requestAccess("You have used the free checks for today. Start your 7-day trial to keep going.");
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
    showDemo();
  });
  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    if (isDemo) track('demo_copy');
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
