// What the bundled engine catches in the cases the store listing names, what
// it leaves alone, and how long a full 20,000-character check takes.
// Every value is synthetic; key-shaped strings are split so scanners skip them.
import assert from 'node:assert/strict';
import { inspectPrompt } from './engine/scanner.js';

const kinds = text => inspectPrompt(text).findings.map(f => f.kind);
const service = text => inspectPrompt(text).findings.find(f => f.credential)?.credential.service;
const found = (text, kind, label) => assert.ok(kinds(text).includes(kind), `${label}: expected ${kind}, got ${kinds(text)}`);
const clean = (text, label) => assert.deepEqual(kinds(text), [], `${label}: expected nothing`);

// Credentials, with the probable service.
found('aws_access_key_id = AKIA' + 'IOSFODNN7EXAMPLE', 'secret', 'AWS access key ID');
assert.equal(service('key AKIA' + '2E0A8F3B244C9986 here'), 'AWS');
found('token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', 'secret', 'GitHub classic token');
found('github_pat_' + '11ABCDEFG0123456789ABC_' + 'a'.repeat(59), 'secret', 'GitHub fine-grained token');
assert.equal(service('ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'), 'GitHub');
found('sk_live_' + '51H8xY2eZvKYlo2C0aBcDeFgHiJ', 'secret', 'Stripe secret key');
found('rk_live_' + '51H8xY2eZvKYlo2C0aBcDeFgHiJ', 'secret', 'Stripe restricted key');
assert.equal(service('sk_live_' + '51H8xY2eZvKYlo2C0aBcDeFgHiJ'), 'Stripe');
clean('pk_live_' + '51H8xY2eZvKYlo2C0aBcDeFgHiJ', 'Stripe publishable key (public by design)');
assert.equal(service('OPENAI_API_KEY=sk-proj-' + 'abcDEF123ghiJKL456mnoPQR789stu'), 'OpenAI (probable)');
assert.equal(service('sk-ant-api03-' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'), 'Anthropic / Claude');
found('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', 'secret', 'JWT');
for (const type of ['RSA', 'EC', 'OPENSSH', '']) {
  const pem = `-----BEGIN ${type ? type + ' ' : ''}PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\n-----END ${type ? type + ' ' : ''}PRIVATE KEY-----`;
  assert.deepEqual(kinds(pem), ['privateKey'], `PEM ${type || 'PKCS#8'} private key`);
  assert.equal(inspectPrompt(`before\n${pem}\nafter`).redactedText, 'before\n[PRIVATE KEY]\nafter');
}
clean('-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----', 'PEM public key');
found('password: hunter2', 'credential', 'password with separator');
clean('the password reset is required', 'the word password in a sentence');
clean('OPENAI_API_KEY=sk-your-api-key-here', 'placeholder key');

// Financial data, validated by checksum.
found('IBAN IT60 X054 2811 1010 0000 0123 456', 'iban', 'Italian IBAN (mod-97 valid)');
found('pay to DE89370400440532013000 thanks', 'iban', 'German IBAN, no spaces');
found('GB82 WEST 1234 5698 7654 32', 'iban', 'UK IBAN');
assert.ok(!kinds('IBAN IT60 X054 2811 1010 0000 0123 457').includes('iban'), 'mod-97 failure is not an IBAN');
found('card 4111 1111 1111 1111', 'card', 'Visa test number (Luhn valid)');
found('card 5500-0000-0000-0004', 'card', 'Mastercard test number with dashes');
found('amex 3782 822463 10005', 'card', 'Amex test number');
assert.ok(!kinds('card 4111 1111 1111 1112').includes('card'), 'Luhn failure is not a card');
clean('order number 1234567890123', 'long order number');

// Personal data.
found('write to maria.rossi@acme.it today', 'email', 'email');
found('mario+test@sub.example.co.uk', 'email', 'email with plus and subdomain');
clean('install react@18.3.1 now', 'npm version is not an email');
found('call +39 02 5555 0180.', 'phone', 'Italian phone ending a sentence');
found('call (415) 555-0132 now', 'phone', 'US phone');
found('ring 020 7946 0958', 'phone', 'UK phone');
clean('meeting on 2026-10-11 at 10:30', 'date and time');
found('codice fiscale RSSMRA85T10A562S', 'fiscalCode', 'Italian fiscal code');
found('cf rssmra85t10a562s', 'fiscalCode', 'Italian fiscal code, lower case');
found('SSN 123-45-6789', 'ssn', 'US Social Security number');
clean('SSN 666-45-6789', 'reserved SSN area');
found('server 192.168.1.10', 'ip', 'IPv4 address');
found('Hi Maria Rossi, thanks', 'name', 'name after a greeting');
clean('Hi team, thanks', 'generic greeting');
found('Ship to 221 Baker Street today', 'address', 'street address');

// Speed: a full-size check of awkward shapes stays far below what a person notices.
const size = 20000, fill = s => s.repeat(Math.ceil(size / s.length)).slice(0, size);
for (const [name, text] of Object.entries({
  prose: fill('The quarterly review covers revenue, hiring plans and the roadmap for next year. '),
  findings: fill('Contact maria.rossi@acme.it or +39 02 5555 0180, IBAN IT60X0542811101000000123456. '),
  digits: fill('1234 5678 9012 3456 7890 '), apostrophes: fill("a'"), markers: fill('-----BEGIN RSA PRIVATE KEY-----\n'),
  jwtLike: fill('eyJhbGciOiJIUzI1NiJ9.'), longLocalPart: 'x'.repeat(size - 12) + '@example.com'
})) {
  const start = performance.now();
  inspectPrompt(text);
  const ms = performance.now() - start;
  assert.ok(ms < 250, `${name}: ${ms.toFixed(1)} ms for 20,000 characters`);
}
// AWS secret access keys are only trusted beside their assignment name.
const awsSecret = 'Zk3Qf9Lm2Xv8Rt5Yp1Nc7Bd4Hs6Jw0Ua+Ge/TiOq';
assert.equal(awsSecret.length, 40);
found('aws_secret_access_key = ' + awsSecret, 'secret', 'AWS secret access key');
found('AWS_SECRET_ACCESS_KEY="' + awsSecret + '"', 'secret', 'AWS secret access key, quoted env style');
assert.equal(service('aws_secret_access_key: ' + awsSecret), 'AWS');
assert.ok(!inspectPrompt('aws_secret_access_key = ' + awsSecret).redactedText.includes(awsSecret), 'secret is redacted');
clean('checksum ' + awsSecret, 'bare 40-character string is not flagged');
clean('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCY' + 'EXAMPLEKEY', 'AWS documentation example');
clean('aws_secret_access_key = ' + 'A'.repeat(40), 'filler value');

// UK National Insurance numbers: valid prefixes only, no documented examples.
found('NI number JG 10 37 59 A', 'niNumber', 'UK National Insurance number with spaces');
found('NINO JG103759A', 'niNumber', 'UK National Insurance number without spaces');
clean('NI QQ 12 34 56 C', 'HMRC example prefix QQ is never issued');
clean('ref BG123456C', 'BG prefix is never issued');
clean('NI AB 12 34 56 C', 'placeholder digits 123456');
clean('NI JG 10 37 59 E', 'suffix must be A to D');

// Checksums: fiscal codes with a wrong check letter are not flagged.
clean('codice fiscale RSSMRA85T10A562T', 'fiscal code with a wrong check letter');

console.log('Detection: credentials with service, checksummed cards and IBANs, personal data, non-findings and 20,000-character timing passed.');
