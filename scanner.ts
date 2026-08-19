export type FindingKind = "email" | "phone" | "secret" | "card" | "ip" | "iban" | "fiscalCode" | "credential" | "ssn" | "crypto" | "privateKey" | "name" | "address" | "custom";

export interface Finding {
  kind: FindingKind;
  label: string;
  value: string;
  replacement: string;
}

export interface ScanOptions {
  includePersonalData: boolean;
  includeCredentials: boolean;
  includeFinancialData: boolean;
  customTerms?: string[];
}

type Rule = Omit<Finding, "value"> & { pattern: RegExp; validate?: (value: string) => boolean };

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const value = raw.replace(/\s+/g, "").toUpperCase();
  if (value.length < 15 || value.length > 34) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let mod = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      for (const digit of String(code - 55)) mod = (mod * 10 + Number(digit)) % 97;
    } else if (code >= 48 && code <= 57) {
      mod = (mod * 10 + (code - 48)) % 97;
    } else {
      return false;
    }
  }
  return mod === 1;
}

function phoneValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function ssnValid(raw: string): boolean {
  // Filters out the reserved/invalid SSN ranges (area 000/666/900-999, group
  // 00, serial 0000) that a bare \d{3}-\d{2}-\d{4} pattern would otherwise
  // false-positive on for things like invoice or order numbers.
  const [area, group, serial] = raw.split("-");
  const areaNum = Number(area);
  if (areaNum === 0 || areaNum === 666 || areaNum >= 900) return false;
  if (Number(group) === 0 || Number(serial) === 0) return false;
  return true;
}

// Contextual, not just pattern-matching: a bare "John Smith" is too common to
// safely flag on its own, but one right after a greeting is almost always
// the actual recipient's name. The stoplist keeps generic salutations
// ("Dear Team", "Hi there") from being misread as a name.
const salutationStoplist = new Set(["team", "all", "everyone", "sir", "madam", "customer", "support", "there", "folks", "friend", "valued", "user", "member", "guys", "colleagues", "reader"]);
function nameValid(raw: string): boolean {
  return !salutationStoplist.has(raw.split(/\s/)[0].toLowerCase());
}

const rules: Rule[] = [
  { kind: "email", label: "Email address", replacement: "[EMAIL]", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "ssn", label: "Social Security Number", replacement: "[SSN]", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, validate: ssnValid },
  {
    kind: "name", label: "Personal name", replacement: "[NAME]",
    pattern: /(?<=\b(?:Dear|Hi|Hello|Hey)[ \t])[A-Z][a-z]+(?:[ \t][A-Z][a-z]+)?(?=[ \t]*[,:])/g,
    validate: nameValid
  },
  {
    kind: "address", label: "Street address", replacement: "[ADDRESS]",
    pattern: /\b\d{1,5}\s[A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,})?\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\.?\b/g
  },
  {
    kind: "secret", label: "API key or token", replacement: "[SECRET]",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{10,}|pk_(?:live|test)_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[\w-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g
  },
  { kind: "privateKey", label: "Private key", replacement: "[PRIVATE KEY]", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "card", label: "Card number", replacement: "[CARD]", pattern: /\b(?:\d[ -]*?){13,16}\b/g, validate: luhnValid },
  { kind: "crypto", label: "Crypto wallet address", replacement: "[WALLET ADDRESS]", pattern: /\b(?:0x[a-fA-F0-9]{40}|bc1[ac-hj-np-z02-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { kind: "iban", label: "IBAN", replacement: "[IBAN]", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, validate: ibanValid },
  { kind: "fiscalCode", label: "Italian fiscal code", replacement: "[FISCAL CODE]", pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  // Deliberately runs after every more specific/structured numeric pattern
  // (SSN, cards, IBANs...): phone's loose "digits, separator, digits" shape
  // will happily match a fragment inside a longer identifier if it runs
  // first, silently corrupting that identifier before its own rule -- which
  // needs the full, unmutated string -- ever gets to see it. Caught by
  // testing a real IBAN through the browser extension with every category
  // enabled at once (the actual default), not just the narrow single-
  // category combinations the original unit tests exercised.
  // The trailing boundary is `(?!\w)(?!\.\d)`, not `(?![\w.])`: the latter
  // rejected any following dot at all, so a phone number ending a sentence
  // ("call me at +39 02 5555 0180.") was silently never flagged, while the
  // very same number followed by a comma was. The dot only means "this is a
  // longer dotted-numeric run, keep out" when a digit follows it.
  { kind: "phone", label: "Phone number", replacement: "[PHONE]", pattern: /(?<![\w.])(?:\+?\d{1,3}[ -]?)?(?:\(?\d{2,4}\)?[ -]?)?\d{3,4}[ -]\d{3,4}(?!\w)(?!\.\d)/g, validate: phoneValid },
  { kind: "ip", label: "IPv4 address", replacement: "[IP ADDRESS]", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: "credential", label: "Password or credential", replacement: "$1$2[REDACTED]", pattern: /\b(password|passwd|pwd|secret)\s*([:=])\s*([^\s,;]{6,})/gi }
];

export function inspectPrompt(text: string, options: ScanOptions = { includePersonalData: true, includeCredentials: true, includeFinancialData: true }): { findings: Finding[]; redactedText: string } {
  const findings: Finding[] = [];
  let redactedText = text;
  for (const rule of rules) {
    const enabled =
      (rule.kind === "email" || rule.kind === "phone" || rule.kind === "ip" || rule.kind === "fiscalCode" || rule.kind === "ssn" || rule.kind === "name" || rule.kind === "address") ? options.includePersonalData :
      (rule.kind === "card" || rule.kind === "iban" || rule.kind === "crypto") ? options.includeFinancialData : options.includeCredentials;
    if (!enabled) continue;
    if (rule.validate) {
      const validate = rule.validate;
      redactedText = redactedText.replace(rule.pattern, (value: string) => {
        if (!validate(value)) return value;
        findings.push({ kind: rule.kind, label: rule.label, value, replacement: rule.replacement });
        return rule.replacement;
      });
    } else {
      const found = [...redactedText.matchAll(rule.pattern)].map((match) => match[0]);
      found.forEach((value) => findings.push({ kind: rule.kind, label: rule.label, value, replacement: rule.replacement }));
      redactedText = redactedText.replace(rule.pattern, rule.replacement);
    }
  }
  const customTerms = [...new Set((options.customTerms ?? []).map((term) => term.trim()).filter((term) => term.length >= 2))];
  for (const term of customTerms) {
    const pattern = new RegExp(escapeRegExp(term), "gi");
    redactedText = redactedText.replace(pattern, (match) => {
      findings.push({ kind: "custom", label: "Custom protected term", value: match, replacement: "[CUSTOM TERM]" });
      return "[CUSTOM TERM]";
    });
  }
  return { findings, redactedText };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
