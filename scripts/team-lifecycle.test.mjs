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
  await exec(binary('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], {windowsHide:true,timeout:30_000});
  startupAttempted = true;
  try {
    // pg_ctl supplies the restricted Windows token required by PostgreSQL.
    await exec(binary('pg_ctl'), ['-D',data,'-l',join(folder,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'], {windowsHide:true,timeout:30_000});
  } catch (error) {
    console.error((await readFile(join(folder,'server.log'),'utf8').catch(()=>'' )).slice(-3000));
    throw error;
  }
  assert.equal(await sql('select 1'), '1');
  console.log('Running migrations and concurrent lifecycle checks.');
  await sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';`);
  for (const file of ['20260811_billing.sql','20260812_team.sql','20260821_scan_events.sql','20260821_organizations.sql','20261002074537_team_lifecycle.sql']) {
    await sql(await readFile(join(root, 'supabase/migrations', file), 'utf8'));
  }
  const owner='00000000-0000-0000-0000-000000000001', member='00000000-0000-0000-0000-000000000002', other='00000000-0000-0000-0000-000000000003', owner2='00000000-0000-0000-0000-000000000004';
  const t1='a'.repeat(32), t2='b'.repeat(32), t3='c'.repeat(32), t4='d'.repeat(32);
  await sql(`insert into auth.users values ('${owner}'),('${member}'),('${other}'),('${owner2}');
    insert into billing_accounts(user_id,plan,subscription_status,seat_count) values ('${owner}','business','active',2),('${owner2}','business','active',3);`);
  for (const fn of ['create_team_invite(uuid,text)','accept_team_invite(text,uuid)','revoke_team_invite(uuid,uuid)']) {
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
  console.log('PostgreSQL team lifecycle regressions passed (isolated cluster).');
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
  await rm(folder,{recursive:true,force:true,maxRetries:3});
}

