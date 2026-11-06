// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { LeaseStore } from '../skills/device-lease/scripts/lease.mjs';
import { loadConfig, resolveDevice } from '../skills/device-lease/scripts/config.mjs';

const cli = resolve('skills/device-lease/scripts/cli.mjs');
function fixture(t, extra = {}) {
  const base = mkdtempSync(join(tmpdir(), 'device-lease-test-'));
  const cleanups = [];
  t.after(() => { for (const cleanup of cleanups) cleanup(); rmSync(base, {recursive: true, force: true}); });
  const root = join(base, 'state'), config = join(base, 'config.json');
  writeFileSync(config, JSON.stringify({root, devices: {phone: 'emulator-5554', otherAlias: 'emulator-5554'}, ...extra}));
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith('DEVICE_LEASE_')) delete env[key];
  env.DEVICE_LEASE_CONFIG = config;
  const run = (args, options = {}) => {
    const child = spawnSync(process.execPath, [cli, ...args, '--json'], {env, encoding: 'utf8', ...options});
    return { code: child.status, data: JSON.parse(child.stdout), stderr: child.stderr };
  };
  return {base, root, config, env, run, cleanups};
}
function storeFixture(t, options = {}) {
  const f = fixture(t);
  let now = 1_700_000_000_000;
  const store = new LeaseStore({root: f.root, clock: () => now, ...options});
  f.cleanups.push(() => store.close());
  return {...f, store, advance: ms => now += ms};
}
const lost = error => error.code === 'LEASE_LOST';

test('aliases share one canonical lease; token works independent of display owner/session', t => {
  const {run,env} = fixture(t);
  const first = run(['reserve','--device','phone','--purpose','test','--owner','agent-a']);
  assert.equal(first.code, 0);
  const second = run(['reserve','--device','otherAlias','--purpose','test','--owner','agent-b']);
  assert.equal(second.code, 2); assert.equal(second.data.code, 'BUSY');
  const renewed = run(['heartbeat','--device','emulator-5554','--token-stdin'], {input:first.data.token, env:{...env,DEVICE_LEASE_OWNER:'different-agent'}});
  assert.equal(renewed.code,0);
});

test('stdin credentials, JSON errors, and no token disclosure', t => {
  const {run, root, env} = fixture(t);
  const claim = run(['reserve','--device','phone','--purpose','test']);
  const token = claim.data.token;
  assert.equal(run(['heartbeat','--device','phone','--token-stdin'], {input:token,env:{...env,CLAUDE_CODE_SESSION_ID:'new-session'}}).code, 0);
  assert.equal(run(['heartbeat','--device','phone','--token','wrong']).code, 3);
  assert.equal(run(['heartbeat','--device','phone']).data.code, 'USAGE');
  const status = run(['status']);
  assert.equal(status.code, 0); assert.ok(!JSON.stringify(status.data).includes(token));
  assert.ok(!readFileSync(join(root,'leases.db')).includes(Buffer.from(token)));
  assert.equal(run(['release','--device','phone','--token-stdin','--message=--finished'], {input:token}).code, 0);
  assert.equal(run(['history','--device','phone']).data.handoffs[0].message, '--finished');
  assert.equal(run(['wut']).code, 64);
  assert.equal(run(['reserve','--device','phone','--purpose','test','--unknown']).code, 64);
});

test('TTL boundary, reclaim, and old-token fencing', t => {
  const {store, advance} = storeFixture(t, {idleTimeoutMinutes: 1});
  const first = store.reserve({device:'phone',purpose:'test'});
  advance(59_999);
  assert.throws(() => store.reserve({device:'phone',purpose:'test'}), e => e.code === 'BUSY');
  advance(1);
  assert.throws(() => store.heartbeat({device:'phone',token:first.token}), lost);
  assert.throws(() => store.release({device:'phone',token:first.token}), lost);
  const second = store.reserve({device:'phone',purpose:'next'});
  assert.equal(second.reclaimed, true);
  assert.throws(() => store.release({device:'phone',token:first.token}), lost);
  assert.equal(store.heartbeat({device:'phone',token:second.token}).state,'heartbeat');
});

test('heartbeat extends persisted TTL; clock rollback freezes expiry while allowing release', t => {
  const {store, advance} = storeFixture(t, {idleTimeoutMinutes: 1});
  const first = store.reserve({device:'phone',purpose:'test'});
  advance(50_000);
  const beat = store.heartbeat({device:'phone',token:first.token});
  assert.equal(beat.lease.expiresAt, first.lease.expiresAt + 50_000);
  advance(-1);
  assert.match(store.status().warnings[0], /clock moved backwards/);
  assert.equal(store.status().leases[0].state, 'reserved');
  assert.throws(() => store.reserve({device:'phone',purpose:'test'}), e => e.code === 'BUSY');
  assert.equal(store.heartbeat({device:'phone',token:first.token}).lease.expiresAt,beat.lease.expiresAt);
  assert.equal(store.release({device:'phone',token:first.token}).state,'released');
});

test('release handoffs are atomic and bounded', t => {
  const {store} = storeFixture(t, {historyLimit:2});
  for (let i=0; i<5; i++) {
    const {token} = store.reserve({device:'phone',purpose:'test'});
    store.release({device:'phone',token,message:`handoff ${i}`});
  }
  assert.deepEqual(store.history('phone').map(row=>row.message), ['handoff 4','handoff 3']);
  assert.deepEqual(store.status().leases, []);
});

test('simultaneous separate processes: exactly one claim succeeds', async t => {
  const {env} = fixture(t);
  const results = await Promise.all(Array.from({length:8}, () => new Promise((resolve,reject) => {
    const child = spawn(process.execPath,[cli,'reserve','--device','phone','--purpose','concurrent','--json'],{env});
    let stdout='', stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
    child.on('error',reject); child.on('close',code=>{try {resolve({code,data:JSON.parse(stdout),stderr});} catch(e) {reject(new Error(`${e.message}: ${stdout} ${stderr}`));}});
  })));
  assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));
  assert.equal(results.filter(r=>r.code===2 && r.data.code==='BUSY').length,7,JSON.stringify(results));
});

test('killed SQLite writer rolls back without deleting another lease', {skip:process.platform==='win32'}, async t => {
  const {root} = fixture(t);
  const store = new LeaseStore({root});
  const held = store.reserve({device:'held',purpose:'keep'}); store.close();
  const child = spawn(process.execPath,['--input-type=module','-e', `
    import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE');
    db.prepare('DELETE FROM leases WHERE device=?').run('held');
    console.log('ready'); setInterval(()=>{},1000);
  `, join(root,'leases.db')],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await once(child.stdout,'data');
  const exited=once(child,'exit'); child.kill('SIGKILL'); await exited;
  const recovered = new LeaseStore({root});
  try {
    assert.equal(recovered.heartbeat({device:'held',token:held.token}).state,'heartbeat');
    assert.equal(recovered.reserve({device:'new',purpose:'after crash'}).state,'reserved');
    assert.equal(recovered.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  } finally {recovered.close();}
});

test('legacy locks fail closed even if stale; doctor reports them', t => {
  const {root,run}=fixture(t);
  mkdirSync(join(root,'old.lock'),{recursive:true,mode:0o700});
  assert.equal(run(['reserve','--device','phone','--purpose','test']).data.code,'LEGACY_STATE');
  const doctor=run(['doctor']);
  assert.equal(doctor.code,70); assert.deepEqual(doctor.data.details.legacyLocks,['old.lock']);
});

test('newer database schema is refused', t => {
  const {root,run}=fixture(t);
  const store=new LeaseStore({root}); store.db.exec('PRAGMA user_version=999'); store.close();
  assert.equal(run(['status']).data.code,'SCHEMA_VERSION');
});

test('private state permissions and unsafe roots', {skip:process.platform==='win32'}, t => {
  const {root,base}=fixture(t); const store=new LeaseStore({root}); store.close();
  assert.equal(statSync(root).mode & 0o777,0o700);
  assert.equal(statSync(join(root,'leases.db')).mode & 0o777,0o600);
  const unsafe=join(base,'public'); mkdirSync(unsafe,{mode:0o755});
  assert.throws(()=>new LeaseStore({root:unsafe}),e=>e.code==='UNSAFE_ROOT');
  const link=join(base,'link'); symlinkSync(root,link);
  assert.throws(()=>new LeaseStore({root:link}),e=>e.code==='UNSAFE_ROOT');
});

test('config precedence, paths, aliases, strict fields, no repo fallback', t => {
  const {config,base}=fixture(t,{idleTimeoutMinutes:10,historyLimit:7});
  const home=join(base,'home'); mkdirSync(home);
  const loaded=loadConfig({config,root:'~/shared','idle-timeout-minutes':'30'}, {DEVICE_LEASE_ROOT:join(base,'env'),DEVICE_LEASE_IDLE_TIMEOUT_MINUTES:'20'}, home);
  assert.equal(loaded.root,join(home,'shared')); assert.equal(loaded.idleTimeoutMinutes,30); assert.equal(loaded.historyLimit,7);
  assert.equal(resolveDevice('phone',loaded),'emulator-5554');
  assert.throws(()=>loadConfig({config,root:'relative'}, {}, home),e=>e.code==='USAGE');
  assert.throws(()=>loadConfig({config:join(base,'missing')}, {}, home),e=>e.code==='CONFIG');
  assert.equal(loadConfig({}, {}, home).root,join(home,'.device-leases'));
  assert.equal(loadConfig({config},{DEVICE_LEASE_ROOT:join(base,'env')},home).root,join(base,'env'));
  assert.throws(()=>resolveDevice('phnoe',loaded),e=>e.code==='CONFIG');
  writeFileSync(config,JSON.stringify({devices:{a:'b',b:'c'}}));
  assert.throws(()=>loadConfig({config},{},home),e=>e.code==='CONFIG');
  writeFileSync(config,JSON.stringify({typo:true}));
  assert.throws(()=>loadConfig({config},{},home),e=>e.code==='CONFIG');
});

test('numeric settings reject booleans, empty strings, hex, and decimals', t => {
  const {root,config,run}=fixture(t);
  for (const bad of [true,false,'','0x10','1.5']) {
    writeFileSync(config,JSON.stringify({root,idleTimeoutMinutes:bad}));
    assert.equal(run(['status']).code,64);
  }
});

test('legacy writer appearing later stops heartbeats and status but allows lease release', t => {
  const {store,root}=storeFixture(t);
  const claim=store.reserve({device:'phone',purpose:'test'});
  mkdirSync(join(root,'later.lock'));
  assert.throws(()=>store.heartbeat({device:'phone',token:claim.token}),e=>e.code==='LEGACY_STATE');
  assert.throws(()=>store.status(),e=>e.code==='LEGACY_STATE');
  assert.equal(store.release({device:'phone',token:claim.token}).state,'released');
});

test('zero history limit disables new handoffs without wiping existing history', t => {
  const {root}=fixture(t);
  let store=new LeaseStore({root});
  const claim=store.reserve({device:'phone',purpose:'test'});
  store.release({device:'phone',token:claim.token,message:'preserve'}); store.close();
  store=new LeaseStore({root,historyLimit:0});
  try {
    const next=store.reserve({device:'phone',purpose:'test'});
    store.release({device:'phone',token:next.token,message:'not saved'});
    assert.equal(store.history('phone',20)[0].message,'preserve');
    assert.equal(store.history('phone',20).length,1);
  } finally {store.close();}
});

test('database lock contention is distinct from a busy device', {timeout:12_000}, async t => {
  const {root,env}=fixture(t);
  const store=new LeaseStore({root}); store.db.exec('BEGIN IMMEDIATE');
  try {
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[cli,'status','--json'],{env});
      let output=''; child.stdout.on('data',c=>output+=c);
      child.on('error',reject); child.on('close',code=>{try {resolve({code,data:JSON.parse(output)});} catch(error){reject(error);}});
    });
    assert.equal(result.code,75); assert.equal(result.data.code,'DB_BUSY');
  } finally {store.db.exec('ROLLBACK'); store.close();}
});

test('explicit stdin token overrides environment and help stays JSON', t => {
  const {run,env}=fixture(t);
  const claim=run(['reserve','--device','phone','--purpose','test']);
  assert.equal(run(['heartbeat','--device','phone','--token-stdin'],{input:claim.data.token,env:{...env,DEVICE_LEASE_TOKEN:'stale'}}).code,0);
  assert.equal(run(['--help']).data.state,'help');
});

test('runtime guard rejects unsupported Node 22 and 23 versions as JSON', t => {
  const {base}=fixture(t);
  const preload=join(base,'version.cjs');
  for (const version of ['20.19.0','22.12.0','23.3.0']) {
    writeFileSync(preload,`Object.defineProperty(process.versions,'node',{value:${JSON.stringify(version)}});`);
    const result=spawnSync(process.execPath,['--require',preload,cli,'status','--json'],{encoding:'utf8'});
    assert.equal(result.status,70);
    assert.equal(JSON.parse(result.stdout).code,'RUNTIME');
  }
});

test('restricted SSH adapter allows only lease operations with fixed config', t => {
  const {config,env,base}=fixture(t);
  const adapter=resolve('scripts/ssh-lease.mjs');
  const run=(request,input)=>{
    const child=spawnSync(process.execPath,[adapter,'--config',config],{
      env:{...env,DEVICE_LEASE_ROOT:join(base,'bypass'),SSH_ORIGINAL_COMMAND:typeof request==='string'?request:JSON.stringify(request)},
      encoding:'utf8',input,
    });
    return {code:child.status,data:JSON.parse(child.stdout)};
  };
  const claim=run({command:'reserve',device:'phone',purpose:'UI verification; $(touch nope)'});
  assert.equal(claim.code,0);
  assert.equal(run({command:'heartbeat',device:'phone'},claim.data.token).code,0);
  assert.equal(run({command:'release',device:'phone'},claim.data.token).code,0);
  assert.equal(run({command:'init'}).code,64);
  assert.equal(run({command:'status',root:'/tmp/bypass'}).code,64);
  assert.equal(run('status; rm -rf /').code,64);
  assert.equal(run({command:'__proto__'}).code,64);
});

test('corrupt database reports a stable error', t => {
  const {root,run}=fixture(t); mkdirSync(root,{mode:0o700});
  writeFileSync(join(root,'leases.db'),'not a database',{mode:0o600});
  assert.equal(run(['doctor']).data.code,'CORRUPT_STATE');
});

test('init refuses overwrites and installed skill is self-contained', t => {
  const {base,run}=fixture(t);
  const path=join(base,'new-config.json');
  assert.equal(run(['init','--config',path]).code,0);
  assert.equal(run(['init','--config',path]).code,64);
  const target=join(base,'installed-skill');
  const installer=resolve('scripts/install-skill.mjs');
  assert.equal(spawnSync(process.execPath,[installer,'--target',target]).status,0);
  assert.equal(spawnSync(process.execPath,[installer,'--target',target]).status,1);
  assert.ok(readFileSync(join(target,'SKILL.md'),'utf8').includes('name: device-lease'));
  assert.equal(spawnSync(process.execPath,[join(target,'scripts','cli.mjs'),'--help']).status,0);
});
