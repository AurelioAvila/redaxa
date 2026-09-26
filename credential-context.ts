export type CredentialContext={service:string;type:string;evidence:string;response:string;guidance:string;docs?:string};
export const credentialValue=(value:string)=>value.replace(/^Bearer[ \t]+/i,'');
export function jwtClaims(value:string):{header:Record<string,unknown>;payload:Record<string,unknown>}|undefined {
 const token=credentialValue(value);
 if(token.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))return undefined;
 try {
  const parts=token.split('.');
  if(parts.some(part=>part.length%4===1))return undefined;
  const [header,payload]=parts.slice(0,2).map(part=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(part,'base64url'))));
  if(!header||Array.isArray(header)||typeof header.alg!=='string'||!header.alg.trim()||!payload||typeof payload!=='object'||Array.isArray(payload))return undefined;
  return {header,payload};
 }catch{return undefined;}
}
export function supabaseIssuer(issuer:unknown):boolean {
 if(issuer==='supabase')return true;
 if(typeof issuer!=='string')return false;
 try {const u=new URL(issuer);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)&&u.pathname==='/auth/v1'&&!u.search&&!u.hash;}catch{return false;}
}
export function credentialContext(kind:string,value:string,label:string,reference:boolean,assignment=''):CredentialContext {
 value=credentialValue(value);
 const rotate='If genuine, revoke or rotate it at the issuing service, update the application, then remove the exposed value from code and review Git history. Deleting it from Git does not revoke access.';
 let context:CredentialContext={service:'Unknown service',type:kind==='privateKey'?'Private signing key':kind==='credential'?'Password or credential':'Access token / secret',evidence:'The value alone does not identify its owner or issuing service.',response:'Identify owner, then rotate if genuine',guidance:rotate};
 const match=(service:string,type:string,evidence:string,docs?:string)=>{context={service,type,evidence,response:'Revoke or rotate if genuine',guidance:rotate,docs};};
 if(/^github_pat_|^gh[pousr]_/.test(value))match('GitHub',value.startsWith('github_pat_')?'Fine-grained personal access token':value.startsWith('ghp_')?'Personal access token':'GitHub app / OAuth token','GitHub-specific token prefix; account and validity are not verified.','https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation');
 else if(/^sk-ant-/.test(value))match('Anthropic / Claude','API key','Anthropic-specific prefix; ownership and permissions are unverified.','https://platform.claude.com/docs/en/manage-claude/authentication');
 else if(/^sk-proj-/.test(value))match('OpenAI (probable)','Project API key','Project-key prefix suggests OpenAI; this is not a live provider check.','https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety');
 else if(/^[spr]k_(?:live|test)_/.test(value))match('Stripe',value.startsWith('pk_')?'Publishable client key':value.startsWith('rk_')?'Restricted API key':value.startsWith('sk_test_')?'Test-mode secret key':'Secret API key','Stripe-style prefix identifies the key category, not its account or validity.','https://docs.stripe.com/keys');
 else if(/^sb_(?:secret|publishable)_/.test(value))match('Supabase',value.startsWith('sb_secret_')?'Secret API key (elevated access)':'Publishable client key','Supabase-specific prefix. Secret keys can bypass Row Level Security; project and validity are not verified.','https://supabase.com/docs/guides/getting-started/api-keys');
 else if(/^(?:xox[baprs]|xapp)-/.test(value))match('Slack',value.startsWith('xoxb-')?'Bot token':value.startsWith('xoxp-')?'User token':value.startsWith('xapp-')?'App-level token':'Slack token','Slack-specific prefix; workspace and scopes are not verified.','https://docs.slack.dev/authentication/tokens/');
 else if(/^AIza/.test(value))context={service:'Google APIs',type:'API key',evidence:'Google-style prefix does not distinguish Maps, Firebase, Gemini or another API.',response:'Check restrictions and exposure',guidance:'Inspect API and application restrictions in Google Cloud. If exposure allows unauthorized use, replace the key and restrict its replacement. A prefix alone cannot prove that a browser key is unsafe.',docs:'https://docs.cloud.google.com/docs/authentication/api-keys-best-practices'};
 else if(/^(?:AKIA|ASIA)/.test(value))context={service:'AWS',type:value.startsWith('ASIA')?'Temporary access key ID':'Access key ID',evidence:'An AWS access-key identifier, not the accompanying secret access key.',response:'Check whether the secret is also exposed',guidance:'Locate the owner and check exposure of the paired secret and, for temporary credentials, session token. Rotate or invalidate compromised credentials in AWS; the identifier alone does not prove usable account access.',docs:'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html'};
 else if(/^eyJ/.test(value)){
  const claims=jwtClaims(value),supabase=supabaseIssuer(claims?.payload.iss);
  const privileged=typeof claims?.payload.role==='string'&&['service_role','admin','owner','root'].includes(claims.payload.role);
  context={service:supabase?'Supabase (claimed issuer)':'Issuer not established',type:label.startsWith('JWT')?label:privileged?'JWT with privileged-role claim':'JWT token candidate',evidence:'Decoded JWT claims are unverified. Neither the issuer, signature, owner nor expiry is authenticated by this check.',response:label.includes('unsubscribe')?'Review link exposure':privileged?'Revoke or rotate if genuine':'Check issuer and session permissions',guidance:'Identify the issuing application and whether this token grants access. If exposed and usable, invalidate the token or session using that service’s controls. Removing the token from a repository does not invalidate it.'};
 }
 else if(/^sk-/.test(value)&&assignment==='OPENAI_API_KEY')match('OpenAI (probable from context)','API key candidate','The adjacent OPENAI_API_KEY assignment suggests OpenAI; a generic sk- prefix alone cannot identify the provider. Ownership and validity are unverified.','https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety');
 if(reference)context={...context,response:'No automatic revocation recommended',guidance:'Recognized public identifier, example or malformed value. Confirm its context; this match alone is not evidence of a leaked secret.'};
 return context;
}
