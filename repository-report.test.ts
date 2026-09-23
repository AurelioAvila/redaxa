import assert from 'node:assert/strict';
import {inspectFile,demoReport} from './repository-scanner.js';
import {aggregateRepositoryReport,reportToText,apiKeyCandidates} from './repository-report.js';

const synthetic='ghp_'+'sYnThEtIcDoNoTuSe9876543210123456789012';
assert.equal(inspectFile('.env.example',"MAIL_FROM='onboarding@resend.dev'")[0]?.disposition,'reference');
for(const value of ['ghp_'+'x'.repeat(36),'sk-proj-'+'x'.repeat(40)]) {
  const r=demoReport();r.findings=inspectFile('.env.example',value);
  assert.equal(aggregateRepositoryReport(r).summary.actionable,0);
  assert.equal(apiKeyCandidates(aggregateRepositoryReport(r).groups).length,0);
  assert.equal(r.findings[0]?.disposition,'reference','Keep recognized placeholders available as references');
}
assert.equal(inspectFile('src/auth.ts','password = computedPassword')[0]?.disposition,'reference');
assert.equal(inspectFile('.env','password = computedPassword')[0]?.disposition,'review','Environment values are literal');
assert.equal(inspectFile('src/images.ts','image="icon@2x.png"')[0]?.disposition,'reference');
assert.equal(inspectFile('teaser.mp4','qXz@qwer.ty')[0]?.disposition,'reference','Unlabelled media byte patterns are not exposure alerts');
assert.equal(inspectFile('teaser.mp4','customer_email=person@company.com')[0]?.disposition,'review','Meaningful email metadata stays reviewable');
assert.equal(inspectFile('teaser.mp4',synthetic)[0]?.disposition,'review','Never suppress API key candidates just because they occur in media');
const priority=demoReport();priority.findings=[...inspectFile('a.env','password = "literal-credential-789"'),...inspectFile('z.env','KEY=AIza'+'aBcd1234'.repeat(4))];
assert.equal(aggregateRepositoryReport(priority).groups[0]?.kind,'credential','High-priority credentials precede medium-context candidates');
assert.ok(reportToText(priority).indexOf('Password or credential —')<reportToText(priority).indexOf('API key or token —'),'Text report follows severity order');
for(const source of ['password: string','password = process.env.USER_PASSWORD','secret: config.apiSecret','password = getPassword()','password = password','password resetToken','password: undefined','secret = ${SECRET_VALUE}','password = "your_password_here"']) {
  const findings=inspectFile('src/auth.ts',source);
  assert.ok(findings.length>0,source);
  assert.ok(findings.every(f=>f.disposition==='reference'),source);
}
assert.equal(inspectFile('src/auth.ts','password = "literal-credential-789"')[0].disposition,'review');
assert.equal(inspectFile('src/auth.ts','password = "literal-credential-789"')[0].severity,'high');
assert.equal(inspectFile('tests/auth.test.ts','password = "literal-credential-789"')[0].severity,'medium');
assert.equal(inspectFile('tests/auth.test.ts','password = "literal-credential-789"')[0].disposition,'review');
assert.equal(inspectFile('.env.example','TOKEN='+synthetic)[0].disposition,'review');
assert.equal(inspectFile('config.env','password = '+synthetic).length,1,'Do not re-detect the prompt scanner’s generated redaction markers');
assert.equal(inspectFile('README.md','Contact support@brand.io for help')[0].disposition,'reference');
assert.equal(inspectFile('export/customer.csv','name,email\nAda,private@company.io')[0].disposition,'review');
assert.equal(inspectFile('settings.env','HOST=10.0.0.3')[0].disposition,'reference');
assert.equal(inspectFile('src/i18n.ts','password: "Contraseña"')[0].disposition,'reference');
assert.equal(inspectFile('src/i18n.ts','password: "RealLiteral0987!"')[0].disposition,'review');
assert.equal(inspectFile('style.css','background: rgb(255 255 255 / 0.5)')[0].disposition,'reference');
assert.equal(inspectFile('customers.csv','phone\n555 123 4567')[0].disposition,'review');
assert.equal(inspectFile('customers.csv','payment_card\n4242 4242 4242 4242')[0].disposition,'review');
assert.equal(inspectFile('wallet.txt','0x'+'a'.repeat(40))[0].disposition,'reference');
const anon='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({iss:'supabase',role:'anon'})).toString('base64url')+'.'+'a'.repeat(32);
assert.equal(inspectFile('public.js',anon)[0].disposition,'reference');
const service='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({iss:'supabase',role:'service_role'})).toString('base64url')+'.'+'a'.repeat(32);
assert.equal(inspectFile('public.js',service)[0].disposition,'review');
const unsubscribe='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({act:'unsubscribe',id:'synthetic-recipient'})).toString('base64url')+'.'+'a'.repeat(32);
const unsubFinding=inspectFile('email.md',unsubscribe,true)[0];
assert.match(unsubFinding.label,/unsubscribe/);assert.equal(unsubFinding.severity,'medium');assert.equal(unsubFinding.disposition,'review');
const jwt='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'synthetic-user'})).toString('base64url')+'.'+'a'.repeat(32);
assert.equal(inspectFile('session.txt',jwt)[0].label,'JWT · signed-token candidate');
assert.equal(inspectFile('public.js',service)[0].severity,'critical');
const jwtPriority=demoReport();jwtPriority.findings=[unsubFinding,...inspectFile('key.env','KEY='+synthetic),...inspectFile('public.js',service)];
assert.equal(aggregateRepositoryReport(jwtPriority).groups.at(-1)?.label,unsubFinding.label);

const report=demoReport();report.findings=[...inspectFile('config.env','KEY='+synthetic),...inspectFile('[history aaaaaaaa]/config.env','KEY='+synthetic),...inspectFile('[history bbbbbbbb]/nested.env','KEY='+synthetic),...inspectFile('src/auth.ts','password: string'),...inspectFile('[history cccccccc]/src/auth.ts','password: string')];
const assessment=aggregateRepositoryReport(report);
assert.equal(apiKeyCandidates(assessment.groups).length,1,'API banner counts a repeated credential once');
assert.equal(apiKeyCandidates(assessment.groups).every(g=>g.disposition==='review'&&g.kind==='secret'),true);
assert.deepEqual(assessment.summary,{rawMatches:5,uniqueFindings:2,actionable:1,reference:1,current:1,historyOnly:0,critical:1,high:0,medium:0,low:0,duplicatesCollapsed:3});
assert.equal(assessment.groups[0].occurrences.length,3);
assert.equal(assessment.groups[0].historyCount,2);
assert.equal(assessment.groups[0].currentCount,1);
assert.equal(assessment.groups[0].path,'config.env');
assert.ok(!JSON.stringify(report).includes(synthetic));
report.findings.push(...inspectFile('[history dddddddd]/old.env','KEY='+synthetic+'X',true));
assert.equal(aggregateRepositoryReport(report).summary.historyOnly,1);
const text=reportToText(report);
assert.ok(text.includes('2 unique candidates'));
assert.ok(!text.includes(synthetic));
assert.ok(!text.includes(report.findings[0].fingerprint!));
// A reference in one context cannot mask a private-data candidate elsewhere.
report.findings=[...inspectFile('README.md','Contact somebody@company.io'),...inspectFile('customers.csv','somebody@company.io')];
assert.equal(aggregateRepositoryReport(report).summary.actionable,1);
// No fingerprint/value: never collapse unrelated redaction placeholders.
report.findings=report.findings.map(f=>{const {fingerprint,...rest}=f;return rest;});
assert.equal(aggregateRepositoryReport(report).groups.length,2);
console.log('Passed repository triage: source expressions, public metadata, real-shaped secrets in examples, public vs privileged JWT, keyed deduplication, history/current locations, conservative context merge and redacted text export.');
const identified=inspectFile('key.env','KEY='+synthetic)[0];assert.equal(identified.credential?.service,'GitHub');
assert.ok(!JSON.stringify(identified.credential).includes(synthetic));
assert.match(inspectFile('key.env','KEY=AIza'+'Ab123456'.repeat(4))[0].credential!.response,/restrictions/);
assert.equal(inspectFile('key.env','KEY=AKIA1234567890ABCDEF')[0].credential?.type,'Access key ID');
assert.equal(inspectFile('key.env','KEY=sk-'+'RandomKey1234'.repeat(3))[0].credential?.service,'Unknown service','Generic sk prefix does not establish OpenAI ownership');
const contextReport=demoReport();contextReport.findings=[identified];assert.match(reportToText(contextReport),/Probable service: GitHub/);assert.ok(!reportToText(contextReport).includes(synthetic));
