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

// Card numbers must pass a Luhn check, otherwise ordinary long digit runs (order IDs,
// tracking numbers) would be flagged as payment cards on every scan.
const validCard = inspectPrompt("Card on file: 4111 1111 1111 1111", {
  includePersonalData: false, includeCredentials: false, includeFinancialData: true
});
assert.deepEqual(validCard.findings.map((finding) => finding.kind), ["card"]);
assert.match(validCard.redactedText, /\[CARD\]/);

const invalidCard = inspectPrompt("Tracking number: 1234 5678 9012 3456", {
  includePersonalData: false, includeCredentials: false, includeFinancialData: true
});
assert.deepEqual(invalidCard.findings, []);
assert.match(invalidCard.redactedText, /1234 5678 9012 3456/);

// IBANs are checked against the mod-97 checksum so near-miss strings (wrong country
// code shape, typo'd digits) are not redacted as if they were real bank details.
const validIban = inspectPrompt("Wire to GB29 NWBK 6016 1331 9268 19", {
  includePersonalData: false, includeCredentials: false, includeFinancialData: true
});
assert.deepEqual(validIban.findings.map((finding) => finding.kind), ["iban"]);

const invalidIban = inspectPrompt("Reference code GB29ZZZZ00000000000000", {
  includePersonalData: false, includeCredentials: false, includeFinancialData: true
});
assert.deepEqual(invalidIban.findings, []);

// Phone matches are bounded to a plausible digit count so short numeric codes are
// not treated as personal data.
const shortCode = inspectPrompt("Your order code is 12-3456", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(shortCode.findings, []);

console.log("PromptShield scanner tests passed.");
