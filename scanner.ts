export type FindingKind = "email" | "phone" | "secret" | "card" | "ip" | "iban" | "fiscalCode" | "credential";

export interface Finding {
  kind: FindingKind;
  label: string;
  value: string;
  replacement: string;
}

type Rule = Omit<Finding, "value"> & { pattern: RegExp };

const rules: Rule[] = [
  { kind: "email", label: "Email address", replacement: "[EMAIL]", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", label: "Phone number", replacement: "[PHONE]", pattern: /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3,4}[ .-]\d{3,4}(?!\w)/g },
  { kind: "secret", label: "API key or token", replacement: "[SECRET]", pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[\w-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g },
  { kind: "card", label: "Card number", replacement: "[CARD]", pattern: /\b(?:\d[ -]*?){13,16}\b/g },
  { kind: "ip", label: "IPv4 address", replacement: "[IP ADDRESS]", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: "iban", label: "IBAN", replacement: "[IBAN]", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g },
  { kind: "fiscalCode", label: "Italian fiscal code", replacement: "[FISCAL CODE]", pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi },
  { kind: "credential", label: "Password or credential", replacement: "$1$2[REDACTED]", pattern: /\b(password|passwd|pwd|secret)\s*([:=])\s*([^\s,;]{6,})/gi }
];

export function inspectPrompt(text: string): { findings: Finding[]; redactedText: string } {
  const findings: Finding[] = [];
  let redactedText = text;
  for (const rule of rules) {
    const found = [...text.matchAll(rule.pattern)].map((match) => match[0]);
    found.forEach((value) => findings.push({ kind: rule.kind, label: rule.label, value, replacement: rule.replacement }));
    redactedText = redactedText.replace(rule.pattern, rule.replacement);
  }
  return { findings, redactedText };
}
