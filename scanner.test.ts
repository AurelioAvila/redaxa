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

// Newer key formats that a plain "sk-" prefix check misses entirely --
// Stripe secret keys use an underscore, not a dash, after "sk".
const stripeKey = inspectPrompt("Use sk_live_51H8x9zAbCdEfGhIjKlMnOpQrSt for the integration", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(stripeKey.findings.map((finding) => finding.kind), ["secret"]);
assert.match(stripeKey.redactedText, /\[SECRET\]/);

const awsKey = inspectPrompt("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(awsKey.findings.map((finding) => finding.kind), ["secret"]);

const jwt = inspectPrompt("token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(jwt.findings.map((finding) => finding.kind), ["secret"]);

const privateKey = inspectPrompt("-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(privateKey.findings.map((finding) => finding.kind), ["privateKey"]);
assert.match(privateKey.redactedText, /\[PRIVATE KEY\]/);

// SSNs are filtered against the reserved area/group/serial ranges so ordinary
// dash-grouped numbers (invoice codes, etc.) of the same shape aren't flagged.
const validSsn = inspectPrompt("SSN: 219-09-9999", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(validSsn.findings.map((finding) => finding.kind), ["ssn"]);

const invalidSsn = inspectPrompt("Invoice ref: 000-12-3456", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(invalidSsn.findings, []);

const cryptoWallet = inspectPrompt("Send funds to 0x71C7656EC7ab88b098defB751B7401B5f6d8976a", {
  includePersonalData: false, includeCredentials: false, includeFinancialData: true
});
assert.deepEqual(cryptoWallet.findings.map((finding) => finding.kind), ["crypto"]);

// Contextual detection: a name is only flagged right after a greeting, and
// generic salutations ("Dear Team") must not be mistaken for a real name.
const greetingName = inspectPrompt("Dear John Smith, please review the attached contract.", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(greetingName.findings.map((finding) => finding.kind), ["name"]);
assert.equal(greetingName.findings[0]?.value, "John Smith");
assert.match(greetingName.redactedText, /Dear \[NAME\],/);

const genericGreeting = inspectPrompt("Hi team, quick update on the roadmap.", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(genericGreeting.findings, []);

const streetAddress = inspectPrompt("Ship it to 221 Baker Street by Friday.", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(streetAddress.findings.map((finding) => finding.kind), ["address"]);
assert.match(streetAddress.redactedText, /\[ADDRESS\]/);

console.log("PromptShield scanner tests passed.");
