// Isolated PostgreSQL only. No production connection or application execution.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, basename} from 'node:path';
import {createServer} from 'node:net';
const exec = promisify(execFile);
// Requires PostgreSQL binaries; override POSTGRES_BIN for another installation.
const bin = process.env.POSTGRES_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin' : (await exec('pg_config',['--bindir'])).stdout.trim());
const root = resolve(import.meta.dirname, '..');
const parent = resolve(tmpdir()), folder = await mkdtemp(join(parent, 'redaxa-team-test-'));
const binary = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const port = await new Promise((ok, reject) => { const socket = createServer(); socket.on('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => ok(port)); }); });
const data = join(folder, 'data');
const connection = ['-X', '-w', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
// Send UTF-8 on stdin: Windows native argv conversion corrupts SQL comments.
const sql = value => new Promise((ok, reject) => {
  const child = execFile(binary('psql'), connection, {windowsHide:true,timeout:10_000,env:{...process.env,PGCONNECT_TIMEOUT:'2'}}, (error, stdout, stderr) => {
    if (error) { error.stderr=stderr; reject(error); } else ok(stdout.trim());
  });
  child.stdin.end(value);
});
let startupAttempted = false;
try {
  console.log('Initializing disposable PostgreSQL cluster.');
  await exec(binary('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8', '--no-sync'], {windowsHide:true,timeout:30_000});
  startupAttempted = true;
  try {
    // pg_ctl supplies the restricted Windows token required by PostgreSQL.
    const sockets = process.platform === 'win32' ? '' : ` -k ${folder}`;
    await exec(binary('pg_ctl'), ['-D',data,'-l',join(folder,'server.log'),'-o',`-h 127.0.0.1 -p ${port}${sockets}`,'-w','start'], {windowsHide:true,timeout:30_000});
  } catch (error) {
    console.error((await readFile(join(folder,'server.log'),'utf8').catch(()=>'' )).slice(-3000));
    throw error;
  }
  assert.equal(await sql('select 1'), '1');
  console.log('Running migrations and concurrent lifecycle checks.');
  await sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    alter default privileges in schema public grant execute on functions to anon, authenticated;`);
  for (const file of ['20260811_billing.sql','20260812_team.sql','20260813_grants.sql','20260821_scan_events.sql','20260821_organizations.sql','20260821_rate_limits_settings.sql','20261002074537_team_lifecycle.sql','20261020_rate_limit_grants.sql','20260821_org_policies.sql','20260821_api_keys_policies.sql','20261021_billing_org_hardening.sql'].filter(file => file !== process.env.REDAXA_SKIP_MIGRATION)) {
    await sql(await readFile(join(root, 'supabase/migrations', file), 'utf8'));
  }
  const owner='00000000-0000-0000-0000-000000000001', member='00000000-0000-0000-0000-000000000002', other='00000000-0000-0000-0000-000000000003', owner2='00000000-0000-0000-0000-000000000004';
  const t1='a'.repeat(32), t2='b'.repeat(32), t3='c'.repeat(32), t4='d'.repeat(32);
  await sql(`insert into auth.users values ('${owner}'),('${member}'),('${other}'),('${owner2}');
    insert into billing_accounts(user_id,plan,subscription_status,seat_count) values ('${owner}','business','active',2),('${owner2}','business','active',3);`);
  // Supabase grants anon/authenticated EXECUTE on new functions by default (simulated above).
  assert.equal(await sql(`select relrowsecurity from pg_class where oid = 'public.rate_limit_counters'::regclass`), 't');
  for (const fn of ['create_team_invite(uuid,text)','accept_team_invite(text,uuid)','revoke_team_invite(uuid,uuid)','rate_limit_hit(text,integer,integer)']) {
    assert.equal(await sql(`select has_function_privilege('anon','${fn}','execute'),has_function_privilege('authenticated','${fn}','execute'),has_function_privilege('service_role','${fn}','execute')`), 'f|f|t');
  }
  const create = (who, token) => `set role service_role; select (create_team_invite('${who}','${token}')).id;`;
  const accept = (token, who) => `set role service_role; select (accept_team_invite('${token}','${who}')).id;`;
  const revoke = (who, id) => `set role service_role; select revoke_team_invite('${who}','${id}');`;
  // Hold the first reservation transaction open while the second waits on the same owner.
  const first=sql(`begin; ${create(owner,t1)} select pg_sleep(0.3); commit;`);
  await new Promise(ok=>setTimeout(ok,60));
  const reservations=await Promise.allSettled([first,sql(create(owner,t2))]);
  assert.equal(reservations.filter(r=>r.status==='fulfilled').length,1);
  assert.match(reservations.find(r=>r.status==='rejected').reason.stderr,/TEAM_FULL/);
  assert.equal(await sql(`select count(*) from team_invites where owner_user_id='${owner}'`),'1');
  const reservedToken=await sql(`select token from team_invites where owner_user_id='${owner}'`);
  await assert.rejects(sql(accept(reservedToken,owner)), error=>/TEAM_SELF/.test(error.stderr));
  await sql(`update billing_accounts set subscription_status='canceled' where user_id='${owner}'`);
  await assert.rejects(sql(accept(reservedToken,member)), error=>/TEAM_PLAN_REQUIRED/.test(error.stderr));
  await sql(`update billing_accounts set subscription_status='active',seat_count=1 where user_id='${owner}'`);
  await assert.rejects(sql(accept(reservedToken,member)), error=>/TEAM_FULL/.test(error.stderr));
  await sql(`update billing_accounts set seat_count=2 where user_id='${owner}'`);
  const claims=await Promise.allSettled([sql(accept(reservedToken,member)),sql(accept(reservedToken,other))]);
  const joined=await sql(`select member_user_id from team_invites where token='${reservedToken}'`);
  assert.ok([member,other].includes(joined));
  assert.equal(await sql(`select count(*) from organization_members where user_id in ('${member}','${other}')`),'1');
  assert.equal(claims.filter(r=>r.status==='fulfilled' && r.value.split('\n').at(-1)).length,1);
  const id=await sql(`select id from team_invites where token='${reservedToken}'`);
  assert.match(await sql(revoke(owner2,id)),/f$/);
  // A failed membership deletion must leave the accepted invite unchanged.
  await sql(`create function deny_delete() returns trigger language plpgsql as $$begin raise exception 'fixture failure'; end$$;
    create trigger fail_member_delete before delete on organization_members for each row execute function deny_delete();`);
  await assert.rejects(sql(revoke(owner,id)),error=>/fixture failure/.test(error.stderr));
  assert.equal(await sql(`select status from team_invites where id='${id}'`),'accepted');
  await sql('drop trigger fail_member_delete on organization_members');
  assert.match(await sql(revoke(owner,id)),/t$/);
  assert.equal(await sql(`select count(*) from organization_members where user_id='${joined}'`),'0');
  assert.equal(await sql(`select count(*) from team_invites where member_user_id='${joined}' and status='accepted'`),'0');
  assert.match(await sql(revoke(owner,id)),/f$/);
  const freshToken='e'.repeat(32);
  await sql(create(owner,freshToken));
  const pendingId=await sql(`select id from team_invites where token='${freshToken}'`);
  assert.match(await sql(revoke(owner,pendingId)),/t$/);
  // Existing organization membership causes full rollback, not a split invitation.
  await sql(create(owner,t3));
  await sql(create(owner2,t4));
  await assert.rejects(sql(accept(t3,owner2)),error=>/TEAM_MEMBERSHIP_CONFLICT/.test(error.stderr));
  assert.equal(await sql(`select status from team_invites where token='${t3}'`),'pending');
  assert.equal(await sql(`select count(*) from organization_members where user_id='${owner2}' and role='owner'`),'1');
  // Accept and revoke racing on one token end with neither entitlement nor org access.
  const raceId=await sql(`select id from team_invites where token='${t3}'`);
  await Promise.all([sql(accept(t3,joined)),sql(revoke(owner,raceId))]);
  assert.equal(await sql(`select status from team_invites where token='${t3}'`),'revoked');
  assert.equal(await sql(`select count(*) from organization_members where user_id='${joined}'`),'0');
  // Stripe events: the second delivery of a running event is refused, also on
  // the very first duplicate (now() made both timestamps equal before).
  const claim = id => sql(`set role service_role; select claim_stripe_event('${id}','checkout.session.completed');`);
  assert.equal(await claim('evt_seq'), 'claimed');
  assert.equal(await claim('evt_seq'), 'in_progress');
  await sql(`set role service_role; select complete_stripe_event('evt_seq');`);
  assert.equal(await claim('evt_seq'), 'completed');
  // Two concurrent deliveries: the one waiting on the first insert must not claim too.
  const held = sql(`begin; set role service_role; select claim_stripe_event('evt_race','t'); select pg_sleep(1); commit;`);
  // Start the second delivery only once the first holds its uncommitted claim.
  while (await sql(`select count(*) from pg_stat_activity where query like '%pg_sleep(1)%' and state = 'active' and pid <> pg_backend_pid()`) !== '1') await new Promise(ok=>setTimeout(ok,20));
  const [firstClaim, secondClaim] = await Promise.all([held, claim('evt_race')]);
  assert.match(firstClaim, /claimed/);
  assert.equal(secondClaim, 'in_progress');
  // A handler that died half way is taken over after five quiet minutes.
  await sql(`update processed_stripe_events set updated_at = now() - interval '6 minutes' where event_id = 'evt_race'`);
  assert.equal(await claim('evt_race'), 'claimed');
  assert.equal(await claim('evt_race'), 'in_progress');

  // Checkout: a subscription that still exists and can bill blocks a second one.
  const buyer='00000000-0000-0000-0000-000000000005';
  await sql(`insert into auth.users values ('${buyer}'); insert into billing_accounts(user_id,stripe_subscription_id,subscription_status) values ('${buyer}','sub_1','active')`);
  const reserve = () => sql(`set role service_role; select (reserve_billing_checkout('${buyer}')).user_id;`);
  for (const [status, expected] of [['active',/active subscription already exists/],['unpaid',/needs attention/],['paused',/needs attention/],['incomplete',/needs attention/]]) {
    await sql(`update billing_accounts set subscription_status='${status}', checkout_lock_at=null, updated_at=now() where user_id='${buyer}'`);
    await assert.rejects(reserve(), error=>expected.test(error.stderr), status);
  }
  // A stale incomplete (its expiry webhook missed) and an ended one do not lock the account.
  for (const [status, age] of [['incomplete','25 hours'],['incomplete_expired','0 minutes'],['canceled','0 minutes']]) {
    await sql(`update billing_accounts set subscription_status='${status}', checkout_lock_at=null, updated_at=now() - interval '${age}' where user_id='${buyer}'`);
    assert.equal(await reserve(), buyer, status);
  }

  // Leaving a workspace, and reading it through RLS with the member's own JWT.
  const owner3='00000000-0000-0000-0000-000000000006', member3='00000000-0000-0000-0000-000000000007', admin3='00000000-0000-0000-0000-000000000008', outsider='00000000-0000-0000-0000-000000000009';
  await sql(`insert into auth.users values ('${owner3}'),('${member3}'),('${admin3}'),('${outsider}');
    insert into billing_accounts(user_id,plan,subscription_status,seat_count) values ('${owner3}','business','active',3);`);
  for (const [who, token] of [[member3,'f'.repeat(32)],[admin3,'9'.repeat(32)]]) { await sql(create(owner3,token)); await sql(accept(token,who)); }
  await sql(`update organization_members set role='admin' where user_id='${admin3}'`);
  const org3 = await sql(`select organization_id from organization_members where user_id='${owner3}'`);
  await sql(`insert into protected_terms(organization_id,term) values ('${org3}','Project Falcon'); insert into org_policies(organization_id,category,action) values ('${org3}','custom','block');`);
  const asUser = (who, query) => sql(`set role authenticated; set request.jwt.claim.sub = '${who}'; ${query}`);
  for (const who of [member3, admin3, owner3]) {
    assert.equal(await asUser(who, 'select count(*) from organization_members'), '3', 'member list readable without recursion');
    assert.equal(await asUser(who, 'select count(*) from organizations'), '1');
    assert.equal(await asUser(who, 'select term from protected_terms'), 'Project Falcon');
    assert.equal(await asUser(who, 'select action from org_policies'), 'block');
  }
  for (const query of ['select count(*) from organization_members','select count(*) from organizations','select count(*) from protected_terms','select count(*) from org_policies']) {
    assert.equal(await asUser(outsider, query), '0', `outsider: ${query}`);
  }
  await assert.rejects(sql(`set role anon; select count(*) from organization_members`), error=>/permission denied/.test(error.stderr));
  assert.equal(await sql(`select has_function_privilege('anon','my_organization_ids()','execute'),has_function_privilege('authenticated','my_organization_ids()','execute'),has_function_privilege('anon','leave_organization(uuid)','execute'),has_function_privilege('authenticated','leave_organization(uuid)','execute'),has_function_privilege('service_role','leave_organization(uuid)','execute')`), 'f|t|f|f|t');
  const leave = who => sql(`set role service_role; select leave_organization('${who}');`);
  await assert.rejects(leave(owner3), error=>/TEAM_OWNER_CANNOT_LEAVE/.test(error.stderr));
  assert.equal(await leave(outsider), '');
  assert.equal(await leave(member3), owner3);
  assert.equal(await sql(`select count(*) from organization_members where user_id='${member3}'`), '0');
  assert.equal(await sql(`select count(*) from team_invites where member_user_id='${member3}' and status='accepted'`), '0');
  assert.equal(await asUser(member3, 'select count(*) from protected_terms'), '0', 'a member who left no longer reads the terms');
  assert.equal(await leave(admin3), owner3);
  assert.equal(await sql(`select count(*) from organization_members where organization_id='${org3}'`), '1');
  // The freed seats can be offered again, and the member who left can join again.
  await sql(create(owner3,'8'.repeat(32)));
  assert.match(await sql(accept('8'.repeat(32),member3)), /[0-9a-f-]{36}$/);
  console.log('PostgreSQL team lifecycle, Stripe event claim, checkout, RLS and leave regressions passed (isolated cluster).');
} finally {
  if (startupAttempted) {
    await exec(binary('pg_ctl'), ['-D',data,'-m','immediate','-w','stop'],{windowsHide:true,timeout:15_000}).catch(()=>{});
    const running = await exec(binary('pg_ctl'), ['-D',data,'status'],{windowsHide:true,timeout:5000}).then(()=>true, error=>{
      if (error.code===3) return false;
      throw new Error(`Could not verify database shutdown; temporary cluster retained at ${folder}`);
    });
    if (running) throw new Error(`Database still running; temporary cluster retained at ${folder}`);
  }
  assert.ok(dirname(resolve(folder))===parent && basename(folder).startsWith('redaxa-team-test-'));
  // Windows releases the stopped server's file handles a moment later.
  await rm(folder,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}

