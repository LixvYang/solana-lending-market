/** INPUT: 请求/响应最小替身、PGlite。 OUTPUT: HTTP 契约与脱敏断言（无 socket）。 POSITION: EP7 HTTP 测试。 SYNC: 同步 folder.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import { seedApi } from './test-utils';
import { route, handle, hostAddress, portNumber } from './server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from '../store/db';
import { encodeBase58 } from '../core/base58';
test('HTTP routes 200/400/404, CORS, safe 500, bigint JSON, health DB probe without socket',async()=>{
 const db=await seedApi();try{
  const signature=run.steps.find(s=>s.label==='bob borrow 5000 tUSDC')!.signatures[0];
  for(const url of ['/api/pool','/api/accounts','/api/activity?limit=2',`/api/activity?bank=${run.addresses.banks.tSOL}`,`/api/liquidations?bank=${run.addresses.banks.tSOL}`,`/api/rate-curve?bank=${run.addresses.banks.tSOL}`,`/api/bank-history?bank=${run.addresses.banks.tSOL}`,`/api/tx/${signature}`,'/api/health']){
   const result=await route(db,'GET',url);assert.equal(result.status,200);assert.equal(result.headers['Access-Control-Allow-Origin'],'http://localhost:5173');
   assert.ok(!/api-key|DATABASE_URL|RPC_URL/.test(result.body));assert.ok(JSON.parse(result.body));
  }
  for(const url of ['/api/activity?limit=NaN','/api/activity?limit=0','/api/activity?limit=1.1','/api/activity?before=bad','/api/activity?bank=invalid','/api/liquidations?bank=invalid','/api/rate-curve','/api/rate-curve?bank=invalid','/api/tx/%ZZ'])assert.equal((await route(db,'GET',url)).status,400);
  for(const url of ['/missing',`/api/tx/${encodeBase58(Buffer.alloc(64,1))}`,`/api/rate-curve?bank=${encodeBase58(Buffer.alloc(32,1))}`])assert.equal((await route(db,'GET',url)).status,404);
  // 公开配置:没有钱包 RPC 时兑换台地址为 null;有则原样返回(不含 RPC 等敏感配置)。
  assert.deepEqual(JSON.parse((await route(db,'GET','/api/config')).body),{faucet_url:null});
  assert.deepEqual(JSON.parse((await route(db,'GET','/api/config',undefined,{faucetUrl:'http://localhost:8788/faucet'} as never)).body),{faucet_url:'http://localhost:8788/faucet'});
  assert.equal((await route(db,'POST','/api/pool')).status,404);assert.equal((await route(db,'OPTIONS','/api/pool')).status,204);
  const bad:Db={query:async()=>{throw Error('DATABASE_URL postgres://secret RPC_URL https://host?api-key=secret');},transaction:db.transaction};
  const failure=await route(bad,'GET','/api/health');assert.equal(failure.status,500);assert.equal(failure.body,'{"error":"internal server error"}');
  await db.query("INSERT INTO raw_tx(signature,slot,tx) VALUES ('big',9223372036854775807,'{}'::jsonb)");
  await db.query("INSERT INTO instructions(signature,ix_index,slot,name,args,accounts,remaining) VALUES ('big',0,9223372036854775807,'unknown','{}','{}','[]')");
  const activity=JSON.parse((await route(db,'GET','/api/activity')).body);assert.equal(activity.items[0].slot,'9223372036854775807');
  const headers:Record<string,string>={};let status=0,body='';
  const res={setHeader:(k:string,v:string)=>{headers[k]=v;},set statusCode(v:number){status=v;},end:(v:string)=>{body=v;}};
  await handle(db,{method:'GET',url:'/api/pool'} as IncomingMessage,res as unknown as ServerResponse);
  assert.equal(status,200);assert.equal(headers['Content-Type'],'application/json; charset=utf-8');assert.equal(JSON.parse(body).banks.length,2);
  assert.equal(portNumber(undefined),8787);assert.equal(portNumber('9000'),9000);for(const p of ['0','65536','NaN','1.5',''])assert.throws(()=>portNumber(p));
  const previousHost = process.env.HOST;
  try { delete process.env.HOST; assert.equal(hostAddress(),'127.0.0.1'); process.env.HOST='0.0.0.0'; assert.equal(hostAddress(),'0.0.0.0'); }
  finally { if(previousHost===undefined)delete process.env.HOST;else process.env.HOST=previousHost; }
 }finally{await db.close();}
});
test('new CLI help and invalid arguments run offline; HTTP serializes actual bigint',async()=>{
 const {spawnSync}=await import('node:child_process');
 for(const script of ['scripts/serve-api.ts','scripts/load-labels.ts']){
  const help=spawnSync(process.execPath,['--import','tsx',script,'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/用法/);
  const invalid=spawnSync(process.execPath,['--import','tsx',script,'--invalid'],{encoding:'utf8'});assert.equal(invalid.status,1);assert.ok(!/api-key|DATABASE_URL|RPC_URL/.test(invalid.stderr));
 }
 const signature=encodeBase58(Buffer.alloc(64,2));
 const bigintDb:Db={query:async <T extends Record<string,unknown>>(sql:string)=>({rows:(sql.includes('raw_tx')?[{signature,slot:9007199254740993n,block_time:null,err:{large:9007199254740993n},tx:{transaction:{signatures:[signature],message:{accountKeys:[],instructions:[]}},meta:{logMessages:[]}}}]:[]) as unknown as T[],rowCount:sql.includes('raw_tx')?1:0}),transaction:async fn=>fn(bigintDb)};
 const response=await route(bigintDb,'GET',`/api/tx/${signature}`);assert.equal(response.status,200);assert.equal(JSON.parse(response.body).err.large,'9007199254740993');
});

// 真实联调时发现:页面用 127.0.0.1 打开时,水龙头(另一个端口)的跨域请求被浏览器拦下，
// 因为 Access-Control-Allow-Origin 写死了 localhost。
import { allowOrigin } from './http-body';
test('CORS 按 Origin 匹配白名单:localhost 与 127.0.0.1 都放行,陌生 Origin 得不到回显', () => {
  assert.equal(allowOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(allowOrigin('http://localhost:5173'), 'http://localhost:5173');
  assert.equal(allowOrigin('https://evil.example'), 'http://localhost:5173'); // 默认值,与来者不同,浏览器会拒绝
  assert.equal(allowOrigin(undefined), 'http://localhost:5173');
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://market.example, https://preview.example';
  try { assert.equal(allowOrigin('https://market.example'), 'https://market.example'); }
  finally { if (previous === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previous; }
});
