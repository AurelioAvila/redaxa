import assert from "node:assert/strict";
import { inspectPrompt } from "./scanner.js";

const fullScan = inspectPrompt("Contact maria@example.com, call +39 333 123 4567, server 192.168.1.20, password=demo-secret-123.");
assert.deepEqual(fullScan.findings.map((finding) => finding.kind), ["email", "phone", "ip", "credential"]);
assert.match(fullScan.redactedText, /\[EMAIL\]/);
assert.match(fullScan.redactedText, /\[IP ADDRESS\]/);
assert.match(fullScan.redactedText, /password=\[REDACTED\]/);

const credentialsOnly = inspectPrompt("maria@example.com password=demo-secret-123", {
  includePersonalData: false,
  includeCredentials: true,
  includeFinancialData: false
});
assert.deepEqual(credentialsOnly.findings.map((finding) => finding.kind), ["credential"]);
assert.match(credentialsOnly.redactedText, /maria@example.com/);

const customRules = inspectPrompt("Send the Acme Client roadmap", {
  includePersonalData: false,
  includeCredentials: false,
  includeFinancialData: false,
  customTerms: ["Acme Client"]
});
assert.deepEqual(customRules.findings.map((finding) => finding.kind), ["custom"]);
assert.equal(customRules.redactedText, "Send the [CUSTOM TERM] roadmap");

console.log("PromptShield scanner tests passed.");
