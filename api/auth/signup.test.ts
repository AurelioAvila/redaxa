import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
const { default: handler } = await import('./signup.js');
const originalFetch = globalThis.fetch;
const calls: unknown[] = [];
globalThis.fetch = async (_url, options) => {
  calls.push(JSON.parse(String(options?.body)));
  return new Response('{}', {status:200});
};
async function invoke(body: unknown) {
  let status = 0;
  const response = {setHeader() {},status(code:number) {status=code;return response;},json() {},end() {}};
  await handler({method:'POST',body,headers:{origin:'https://promptshield-beta.vercel.app'}},response);
  return status;
}
try {
  assert.equal(await invoke({email:'sample@example.com',password:'fictional-test-password'}),200);
  assert.deepEqual((calls[0] as {data:unknown}).data,{});
  assert.equal(await invoke({email:'sample@example.com',password:'short'}),400);
  assert.equal(calls.length,1);
  assert.equal(await invoke({email:'sample@example.com',password:'fictional-test-password',firstName:'Demo',lastName:'Do not collect',dateOfBirth:'1990-01-01'}),200);
  assert.deepEqual((calls[1] as {data:unknown}).data,{first_name:'Demo'});
  console.log('Signup accepts minimal profile, rejects weak password, ignores obsolete personal fields.');
} finally { globalThis.fetch=originalFetch; }
