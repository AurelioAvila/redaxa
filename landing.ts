import { track } from './growth.js';
import { OFFER_WORDS_EN, PROMO_WORDS_EN, mountOfferExtras, mountPromo, promoPriceHtml, type PromoView } from './promo.js';
import { TRIAL_UI, chargeDate, choiceCopy, loadPrices, money, priceFor, type BillingView, type PriceList } from './trial.js';

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
  let yearly = true;
  let view: PromoView | null = null;
  // Stripe's prices and the trial switch, through the server; the page ships today's list prices until they arrive.
  let prices: PriceList | null = null;
  // The signed-in account's own billing, once auth.ts has read it (undefined: not known, null: signed out).
  let billing: BillingView | null | undefined;
  const trialOn = (): boolean => (billing?.trialEnabled ?? prices?.trialEnabled) === true;
  // The sentences that name the trial's length follow the switch.
  const renderTrialCopy = (): void => {
    // The build already wrote the wording for the current switch; change it only once the server has answered.
    if (prices === null && billing?.trialEnabled === undefined) return;
    document.querySelectorAll<HTMLElement>('[data-trial-copy]').forEach(el => {
      if (el.dataset.legacyCopy === undefined) el.dataset.legacyCopy = el.textContent ?? '';
      const days = billing?.trialDays ?? prices?.trialDays;
      el.textContent = trialOn() && days
        ? (el.dataset.trialCopy ?? '').replaceAll('{days}', String(days))
        : el.dataset.legacyCopy;
    });
    const fine = document.querySelector<HTMLElement>('#promo-fine');
    if (fine) fine.textContent = trialOn() ? TRIAL_UI.en.promoFine : PROMO_WORDS_EN.fine;
  };
  // "Start 3-day free trial" and "Subscribe now" while the trial is on; one button as before while it is off.
  const renderChoice = (): void => {
    const interval = yearly ? 'yearly' : 'monthly';
    const offerTrial = trialOn() && (billing === undefined || billing === null || billing.canStartTrial);
    document.querySelectorAll<HTMLElement>('.plan-actions').forEach(actions => {
      const primary = actions.querySelector<HTMLElement>('[data-plan]:not(.plan-now)');
      const now = actions.querySelector<HTMLElement>('.plan-now');
      const line = actions.querySelector<HTMLElement>('.plan-choice-line');
      const note = actions.querySelector<HTMLElement>('.plan-choice-note');
      if (!primary || !now || !line || !note) return;
      const plan = primary.dataset.plan ?? 'personal';
      const copy = choiceCopy('en', { interval, price: priceFor(prices, plan, interval), promo: view?.offer(plan, interval) ?? null, trialDays: prices?.trialDays ?? 3, date: prices ? chargeDate(prices) : new Date(Date.now() + 3 * 86_400_000) });
      const show = (el: HTMLElement, text: string | null): void => { el.textContent = text ?? ''; el.hidden = !text; };
      now.hidden = !offerTrial;
      if (offerTrial) {
        primary.dataset.choice = 'trial';
        primary.textContent = copy.trialLabel;
        // The terms next to the button: length and charge from choiceCopy, plus the payment method checkout asks for.
        show(line, copy.trialLine && `${copy.trialLine} A card or another payment method is needed to start. Prices exclude VAT.`);
        show(note, copy.nowLine);
      } else if (trialOn()) {
        primary.dataset.choice = 'now';
        primary.textContent = copy.nowLabel;
        show(line, null);
        show(note, billing ? TRIAL_UI.en.trialUsed : null);
      } else {
        primary.dataset.choice = '';
        primary.textContent = plan === 'business' ? 'Get Business' : 'Go Pro';
        // Until the server confirms the trial switch, the trial terms the build wrote for the yearly default stay.
        if (prices !== null || billing?.trialEnabled !== undefined || !yearly) show(line, null);
        show(note, null);
      }
    });
  };
  // The page ships regular prices; a running offer replaces them only once the
  // server has confirmed it, and they come back the moment it ends.
  const renderPrices = (): void => {
    const interval = yearly ? 'yearly' : 'monthly';
    const pro = view?.offer('personal', interval);
    const business = view?.offer('business', interval);
    const listed = (plan: string, unit: string): string | null => {
      const price = priceFor(prices, plan, interval);
      if (!price) return null;
      const equiv = yearly ? `<small class="price-equiv">${money(Math.round(price.amount / 12), price.currency)} a month, billed yearly</small>` : '';
      return `${money(price.amount, price.currency)} <small>${unit}</small>${equiv}`;
    };
    required('#pro-plan-price').innerHTML = pro
      ? promoPriceHtml(pro, PROMO_WORDS_EN)
      : listed('personal', yearly ? '/ year' : '/ month') ?? (yearly ? '€79.90 <small>/ year</small><small class="price-equiv">€6.66 a month, billed yearly</small>' : '€7.99 <small>/ month</small>');
    required('#business-plan-price').innerHTML = business
      ? promoPriceHtml(business, PROMO_WORDS_EN)
      : listed('business', yearly ? '/ user / year' : '/ user / month') ?? (yearly ? '€149.90 <small>/ user / year</small><small class="price-equiv">€12.49 a month, billed yearly</small>' : '€14.99 <small>/ user / month</small>');
    renderChoice();
  };
  billingButtons.forEach(button => button.addEventListener('click', () => {
    yearly = button.dataset.billing === 'yearly';
    billingButtons.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    renderPrices();
    document.querySelectorAll<HTMLElement>('[data-plan]').forEach(cta => { cta.dataset.interval = yearly ? 'yearly' : 'monthly'; });
  }));
  // The strip above the page and the card under the hero buttons show the same offer, from the same answer.
  const offerExtras = mountOfferExtras(OFFER_WORDS_EN, 'en', strip => required('.nav').before(strip), card => required('.hero .cta-row').after(card));
  // No banner low on the page: the strip and the card above carry the offer, and the
  // plans keep the struck prices with the note that explains them.
  const promoFine = required<HTMLElement>('#promo-fine');
  promoFine.textContent = PROMO_WORDS_EN.fine;
  void loadPrices().then(next => { if (next) { prices = next; renderTrialCopy(); renderPrices(); } });
  document.addEventListener('redaxa:account', event => {
    billing = (event as CustomEvent<{ billing?: BillingView | null } | null>).detail?.billing ?? null;
    renderTrialCopy();
    renderPrices();
  });
  document.addEventListener('redaxa:trial-unavailable', () => {
    document.querySelectorAll<HTMLElement>('.plan-choice-note').forEach(note => { note.textContent = TRIAL_UI.en.trialUsed; note.hidden = false; });
  });
  mountPromo(null, () => PROMO_WORDS_EN, () => 'en', next => {
    view = next;
    promoFine.hidden = !next.promo;
    renderPrices();
  }, offerExtras);
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
    resultCopy.textContent = 'Demo with fictional data, answered without a scan. Replace it with your own text to run a real check.';
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
        auth.requestAccess(trialOn() ? `You have used the free checks for today. Choose a plan to keep going; you can try it free for ${billing?.trialDays ?? prices?.trialDays ?? 3} days.` : "You have used the free checks for today. Choose a plan to keep going; eligible new subscribers start with a 3-day free trial.");
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
