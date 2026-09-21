import assert from "node:assert/strict";
import { inspectPrompt } from "./scanner.js";

for (const value of ['@', '@scope/package', 'someone@', '@company.com', 'name..surname@company.com', '.name@company.com', 'name.@company.com', 'name@-company.com', 'name@company-.com', 'name@company..com', 'name@company.com_extra', 'a@@company.com', 'react@18.2.0', 'foo@localhost', 'a'.repeat(65)+'@company.com', 'a@'+'b'.repeat(64)+'.com']) {
  assert.equal(inspectPrompt(value).findings.filter(f=>f.kind==='email').length,0,`Malformed email/technical token: ${value}`);
}
for (const value of ['name.surname+tag@sub.company.com', "o'brien@company.com", 'first_last@company.io']) {
  const result=inspectPrompt(`Contact <${value}>.`);
  assert.equal(result.findings.filter(f=>f.kind==='email').length,1,value);
  assert.ok(!result.redactedText.includes(value));
}
assert.equal(inspectPrompt("EMAIL='person@company.com'").findings[0]?.value,'person@company.com','Do not capture opening source-code quotes');
assert.equal(inspectPrompt("EMAIL='person@company.com'").redactedText,"EMAIL='[EMAIL]'");
const pat='github_pat_'+'Ab9cDe1Fg2Hi3Jk4Lm5No6Pq7Rs8Tu9Vw0'.repeat(3).slice(0,82);
assert.equal(inspectPrompt(pat).findings[0]?.kind,'secret','fine-grained GitHub token');
for(const value of [pat.slice(0,-1),pat+'A']) assert.equal(inspectPrompt(value).findings.filter(f=>f.kind==='secret').length,0,'Reject wrong-length fine-grained token');
for(const value of ['ghp_'+'x'.repeat(36),'sk-proj-'+'x'.repeat(40),'pk_live_1234567890abcdefghijkl']) {
  assert.equal(inspectPrompt(value).findings.filter(f=>f.category==='credentials').length,0,'Known placeholder/public key is not a prompt credential alert');
}
assert.equal(inspectPrompt('secret = '+pat).findings.filter(f=>f.category==='credentials').length,1,'No second finding for generated redaction marker');

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

// Regression test: with every category on at once (the real default used by
// the dashboard and the browser extension, not the narrow single-category
// slices above), the phone rule previously ran before the IBAN rule and ate
// a digit group in the middle of the IBAN, so the IBAN pattern never
// matched the full, uncorrupted string. Caught via the browser extension
// against a real IBAN on claude.ai.
const ibanWithEverythingOn = inspectPrompt("My IBAN is GB29 NWBK 6016 1331 9268 19", {
  includePersonalData: true, includeCredentials: true, includeFinancialData: true
});
assert.deepEqual(ibanWithEverythingOn.findings.map((finding) => finding.kind), ["iban"]);
assert.match(ibanWithEverythingOn.redactedText, /\[IBAN\]/);

// Regression test: a phone number that ends a sentence was silently missed,
// because the trailing boundary rejected *any* following dot rather than only
// a dot that continues a numeric run. The comma-terminated variant matched all
// along, which is why the gap survived the original tests.
const phoneEndingSentence = inspectPrompt("Call me at +39 02 5555 0180.", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(phoneEndingSentence.findings.map((finding) => finding.kind), ["phone"]);
assert.match(phoneEndingSentence.redactedText, /\[PHONE\]\./);

// ...but a dot that is followed by more digits still means "part of a longer
// dotted number", not the end of a sentence, so it must stay unmatched.
const dottedRun = inspectPrompt("Build 10 2024.1234.5678 shipped", {
  includePersonalData: true, includeCredentials: false, includeFinancialData: false
});
assert.deepEqual(dottedRun.findings, []);

// Regression test: casual chat rarely includes the colon a strict
// "password: x" pattern required, so "password albert00" (typed live through
// the browser extension) went completely undetected. A credential-shaped
// token after "password" (contains a digit, or mixes case) must now be
// flagged even with no separator at all.
const casualPassword = inspectPrompt("password albert00", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(casualPassword.findings.map((finding) => finding.kind), ["credential"]);
assert.match(casualPassword.redactedText, /password \[REDACTED\]/);

// ...but plain English words that happen to follow "password" in an ordinary
// sentence must not be misread as a leaked credential.
const passwordSentence = inspectPrompt("Please reset your password before Friday.", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(passwordSentence.findings, []);

const passwordAdvice = inspectPrompt("Meglio usare una password unica e lunga.", {
  includePersonalData: false, includeCredentials: true, includeFinancialData: false
});
assert.deepEqual(passwordAdvice.findings, []);

console.log("Redaxa scanner tests passed.");
