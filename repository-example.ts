import type {RepoReport} from './repository-scanner.js';
// Illustrative fixture only. The detection engine is never shipped as website JS.
export function repositoryExample():RepoReport {
  const report:RepoReport={repository:'example / sample-project',commit:'Synthetic example — not a live scan',scanned:2,total:2,skipped:0,partial:false,inventoryComplete:true,folders:1,findingsTruncated:false,demo:true,durationMs:0,
    coverage:[{path:'.env.example',status:'scanned',reason:'Synthetic example'},{path:'README.md',status:'scanned',reason:'Synthetic example'}],warnings:['Fictional example demonstrating the report layout; no repository or credential was contacted.'],
    findings:[{kind:'secret',fingerprint:'synthetic-key',path:'.env.example',line:2,label:'API key or token',severity:'critical',category:'credentials',masked:'[REDACTED]',value:'sk-DEMO-ONLY-NOT-A-REAL-CREDENTIAL',disposition:'review',reason:'Illustrative API credential candidate. A real scan does not test key validity.',action:'If real, revoke or rotate the key and review access logs.'},
    {kind:'email',fingerprint:'synthetic-email',path:'README.md',line:4,label:'Email address',severity:'info',category:'personal',masked:'[REDACTED]',value:'you@example.com',disposition:'reference',reason:'Reserved example address, excluded from the review count.',action:'Informational example.'}]};
  report.findings[0].credential={service:'GitHub · illustrative example',type:'Personal access token',evidence:'Synthetic example of provider context. No credential or account was contacted.',response:'Revoke or rotate if genuine',guidance:'Revoke the token at its issuing service, update the application, then remove the exposed value from code and review Git history. Deleting it from Git does not revoke access.',docs:'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation'};
  return report;
}
