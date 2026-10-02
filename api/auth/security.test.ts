import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://fixture.supabase.invalid";
process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-publishable";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.APP_URL = "https://redaxa.example";
const {default: callback} = await import("./callback.js");
const {default: signin} = await import("./signin.js");
type Headers = Record<string, string | string[] | undefined>;
async function invoke(handler: typeof signin, method: string, headers: Headers = {}, body: unknown = {}) {
  const written = new Map<string, string | string[]>();
  let status = 0;
  let result: unknown;
  const response = {
    setHeader(name:string, value:string|string[]) { written.set(name,value); },
    status(code:number) { status=code; return response; },
    json(value:unknown) { result=value; }, end() {}
  };
  await handler({method,headers,body}, response);
  return {status,result,written};
}
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async () => {
    calls++;
    return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',user:{email:'fixture@example.test'}});
  };
  for (const body of [{access_token:'attacker-access',refresh_token:'attacker-refresh'}, {}]) {
    const result = await invoke(callback, 'POST', {'content-type':'application/json'}, body);
    assert.equal(result.status,410);
    assert.equal(result.written.get('Cache-Control'),'no-store');
    assert.equal(result.written.has('Set-Cookie'),false);
  }
  assert.equal((await invoke(callback,'OPTIONS')).status,204);
  assert.equal((await invoke(callback,'GET')).status,405);
  assert.equal(calls,0,'Retired callback never contacts upstream');
  const body = {email:'fixture@example.test',password:'fixture-password'};
  for (const contentType of [undefined,'text/plain','application/x-www-form-urlencoded','multipart/form-data']) {
    assert.equal((await invoke(signin,'POST',{'content-type':contentType},body)).status,415);
  }
  for (const origin of ['https://attacker.example','null',['https://redaxa.example','https://attacker.example']]) {
    assert.equal((await invoke(signin,'POST',{'content-type':'application/json',origin},body)).status,403);
  }
  assert.equal(calls,0,'Untrusted sign-in submissions stop before credential exchange');
  for (const origin of [undefined,'https://redaxa.example','https://tauri.localhost','chrome-extension://fixture']) {
    const result = await invoke(signin,'POST',{'content-type':'application/json; charset=UTF-8',origin},body);
    assert.equal(result.status,200);
    assert.equal(result.written.has('Set-Cookie'),true);
  }
  assert.equal(calls,4);
} finally { globalThis.fetch=originalFetch; }
console.log('Retired callback and JSON/origin sign-in boundaries passed without live requests.');
