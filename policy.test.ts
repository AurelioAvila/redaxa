// Policy layer tests: deterministic decisions, strongest-action-wins,
// explainability, and the guarantee that serialized decisions never carry
// finding values (indexes only).
import assert from "node:assert/strict";
import { inspectPrompt, type Finding } from "./scanner.js";
import { defaultPersonalPolicy, evaluatePolicy, type PolicyRule } from "./policy.js";

function finding(partial: Partial<Finding> & Pick<Finding, "kind" | "category" | "severity">): Finding {
  return { label: "x", value: "raw-value", replacement: "[X]", ...partial };
}

// --- strongest action wins ---------------------------------------------------
{
  const rules: PolicyRule[] = [
    { id: "warn-personal", name: "Warn personal", enabled: true, match: { categories: ["personal"] }, action: "warn", reason: "r1" },
    { id: "block-creds", name: "Block credentials", enabled: true, match: { categories: ["credentials"] }, action: "block", reason: "r2" }
  ];
  const decision = evaluatePolicy(
    [finding({ kind: "email", category: "personal", severity: "medium" }), finding({ kind: "secret", category: "credentials", severity: "critical" })],
    rules
  );
  assert.equal(decision.action, "block");
  assert.equal(decision.decidedBy?.ruleId, "block-creds");
  assert.equal(decision.matched.length, 2);
}

// --- nothing matched → allow, with a null decider ---------------------------
{
  const decision = evaluatePolicy([finding({ kind: "email", category: "personal", severity: "medium" })], [
    { id: "creds", name: "Creds only", enabled: true, match: { categories: ["credentials"] }, action: "block", reason: "r" }
  ]);
  assert.equal(decision.action, "allow");
  assert.equal(decision.decidedBy, null);
}

// --- disabled rules never fire ----------------------------------------------
{
  const decision = evaluatePolicy([finding({ kind: "secret", category: "credentials", severity: "critical" })], [
    { id: "off", name: "Disabled", enabled: false, match: { categories: ["credentials"] }, action: "block", reason: "r" }
  ]);
  assert.equal(decision.action, "allow");
}

// --- a conditionless rule is ignored, not treated as match-all ---------------
{
  const decision = evaluatePolicy([finding({ kind: "email", category: "personal", severity: "medium" })], [
    { id: "empty", name: "Match everything by accident", enabled: true, match: {}, action: "block", reason: "r" }
  ]);
  assert.equal(decision.action, "allow");
}

// --- minSeverity gates correctly ---------------------------------------------
{
  const rules: PolicyRule[] = [
    { id: "high-up", name: "High and up", enabled: true, match: { minSeverity: "high" }, action: "redact", reason: "r" }
  ];
  assert.equal(evaluatePolicy([finding({ kind: "ip", category: "personal", severity: "low" })], rules).action, "allow");
  assert.equal(evaluatePolicy([finding({ kind: "card", category: "financial", severity: "high" })], rules).action, "redact");
}

// --- decisions reference findings by index, never by value -------------------
{
  const decision = evaluatePolicy([finding({ kind: "secret", category: "credentials", severity: "critical", value: "sk-SUPERSECRET" })], defaultPersonalPolicy);
  const serialized = JSON.stringify(decision);
  assert.ok(!serialized.includes("SUPERSECRET"), "a serialized decision must never contain a finding's raw value");
  assert.deepEqual(decision.decidedBy?.findingIndexes, [0]);
}

// --- default policy over real engine output ---------------------------------
{
  const { findings } = inspectPrompt("Contact marco.rossi@acme.com, api key sk_live_abcdefgh12345678");
  const decision = evaluatePolicy(findings, defaultPersonalPolicy);
  assert.equal(decision.action, "redact");
  assert.equal(decision.decidedBy?.ruleId, "default-credentials");
  // Both the credentials rule and the personal-data rule should have matched.
  assert.deepEqual(decision.matched.map((m) => m.ruleId).sort(), ["default-credentials", "default-personal"]);
}

// --- engine now reports category/severity on every finding -------------------
{
  const { findings } = inspectPrompt("IBAN IT60X0542811101000000123456 and password: Hunter22");
  assert.ok(findings.every((f) => typeof f.category === "string" && typeof f.severity === "string"));
  const iban = findings.find((f) => f.kind === "iban");
  assert.equal(iban?.category, "financial");
  assert.equal(iban?.severity, "high");
  const credential = findings.find((f) => f.kind === "credential");
  assert.equal(credential?.category, "credentials");
  assert.equal(credential?.severity, "critical");
}

console.log("policy tests passed");
