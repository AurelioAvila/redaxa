// The policy layer: given what detection FOUND, decide what SHOULD HAPPEN.
//
// This is deliberately a separate module from scanner.ts — the core
// architectural boundary of the product:
//
//   Detection:   "What is here?"        (scanner.ts)
//   Policy:      "What should happen?"  (this file)
//   Enforcement: "Make it happen."      (each surface: web/extension/desktop)
//   Audit:       "What happened?"       (scan events, metadata only)
//
// Rules are deterministic, ordered, and explainable: every decision names the
// rule that produced it and the findings that matched, so any surface can
// answer "why?" without re-deriving the logic. No rule here ever inspects the
// raw text — policies speak only the detection vocabulary (category/kind/
// severity), which is what will later let organizations author their own
// rules without touching regexes.

import type { Finding, FindingCategory, FindingKind, FindingSeverity } from "./scanner.js";

// Ordered weakest → strongest. A decision is the STRONGEST action any matched
// rule requests: if one rule says BLOCK and another says WARN, the answer is
// BLOCK — anything else would let a lenient rule undo a strict one.
export type PolicyAction = "allow" | "warn" | "redact" | "block";
const actionStrength: Record<PolicyAction, number> = { allow: 0, warn: 1, redact: 2, block: 3 };

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  /** A finding matches when it satisfies EVERY listed condition; an omitted
   *  condition matches anything. An empty rule would match everything, so at
   *  least one condition is required by evaluatePolicy. */
  match: {
    categories?: FindingCategory[];
    kinds?: FindingKind[];
    minSeverity?: FindingSeverity;
  };
  action: PolicyAction;
  /** Human sentence shown with the decision. Written once, next to the rule,
   *  so the explanation can never drift from the behavior. */
  reason: string;
}

export interface MatchedRule {
  ruleId: string;
  ruleName: string;
  action: PolicyAction;
  reason: string;
  /** Indexes into the findings array handed to evaluatePolicy — never copies
   *  of the findings themselves, so a serialized decision cannot leak values. */
  findingIndexes: number[];
}

export interface PolicyDecision {
  action: PolicyAction;
  /** The single rule whose action won (strongest). Null only when action is
   *  "allow" because nothing matched. */
  decidedBy: MatchedRule | null;
  matched: MatchedRule[];
}

const severityRank: Record<FindingSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function findingMatches(finding: Finding, rule: PolicyRule): boolean {
  if (rule.match.categories && !rule.match.categories.includes(finding.category)) return false;
  if (rule.match.kinds && !rule.match.kinds.includes(finding.kind)) return false;
  if (rule.match.minSeverity && severityRank[finding.severity] < severityRank[rule.match.minSeverity]) return false;
  return true;
}

export function evaluatePolicy(findings: Finding[], rules: PolicyRule[]): PolicyDecision {
  const matched: MatchedRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    // A rule with no conditions would silently match every prompt; that is
    // never an intentional policy, so it is ignored rather than honored.
    if (!rule.match.categories && !rule.match.kinds && !rule.match.minSeverity) continue;
    const indexes = findings.map((finding, index) => (findingMatches(finding, rule) ? index : -1)).filter((index) => index >= 0);
    if (indexes.length === 0) continue;
    matched.push({ ruleId: rule.id, ruleName: rule.name, action: rule.action, reason: rule.reason, findingIndexes: indexes });
  }
  if (matched.length === 0) return { action: "allow", decidedBy: null, matched };
  const decidedBy = matched.reduce((strongest, candidate) => (actionStrength[candidate.action] > actionStrength[strongest.action] ? candidate : strongest));
  return { action: decidedBy.action, decidedBy, matched };
}

// The default personal-tier policy. It mirrors what the product already does
// today — detection surfaces the risk, redaction is offered, the user stays
// in charge — so shipping it changes zero behavior. What it adds is the
// explanation: every scan can now say WHICH rule fired and WHY. Organization-
// authored rules will use the same shapes with an org id attached.
export const defaultPersonalPolicy: PolicyRule[] = [
  {
    id: "default-credentials",
    name: "Protect credentials",
    enabled: true,
    match: { categories: ["credentials"] },
    action: "redact",
    reason: "Passwords, API keys and private keys should never reach an AI model."
  },
  {
    id: "default-financial",
    name: "Protect financial data",
    enabled: true,
    match: { categories: ["financial"] },
    action: "redact",
    reason: "Card numbers, IBANs and wallet addresses are directly abusable if leaked."
  },
  {
    id: "default-personal",
    name: "Flag personal data",
    enabled: true,
    match: { categories: ["personal"] },
    action: "warn",
    reason: "Personal identifiers were found — review before sharing."
  },
  {
    id: "default-custom-terms",
    name: "Flag protected terms",
    enabled: true,
    match: { categories: ["custom"] },
    action: "warn",
    reason: "A term you marked as protected appears in this prompt."
  }
];
