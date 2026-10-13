import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {openDatabase} from '../src/db.mjs';
import {createService} from '../src/service.mjs';
import {dispatchMcp,listMcpTools,validateModernMcp,MCP_VERSION} from '../src/mcp.mjs';
const make=()=>{const db=openDatabase(':memory:');return {db,service:createService(db)};};
test('modern MCP dispatch advertises exactly the approved 12 P0 tools',()=>{
 const {db,service}=make();
 try{
  const tools=listMcpTools(service);assert.equal(tools.length,12);
  assert.ok(tools.every(t=>t.inputSchema.type==='object'));
  assert.ok(tools.some(t=>t.name==='project.get_context'));
  assert.ok(!tools.some(t=>t.name==='collaboration.handoff'));
  const list=dispatchMcp(service,{jsonrpc:'2.0',id:7,method:'tools/list'});
  assert.equal(list.id,7);assert.equal(list.result.tools.length,12);
  const bad=dispatchMcp(service,{jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'project.get_context',arguments:{project_id:'nonexistent'}}});
  assert.equal(bad.result.isError,true);
  assert.match(bad.result.content[0].text,/NOT_FOUND/);
 }finally{db.close();}
});
test('modern HTTP metadata mismatch is rejected',()=>{
 const message={jsonrpc:'2.0',id:1,method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':MCP_VERSION,'io.modelcontextprotocol/clientInfo':{name:'test',version:'1'}}}};
 const headers={'mcp-protocol-version':MCP_VERSION,'mcp-method':'tools/list'};
 assert.equal(validateModernMcp(message,headers),null);
 assert.equal(validateModernMcp(message,{...headers,'mcp-method':'tools/call'}).code,-32020);
 assert.equal(validateModernMcp(message,{...headers,'mcp-protocol-version':'1900-01-01'}).code,-32022);
});
test('stdio MCP initializes and lists tools without leaking app logging to stdout',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radar-mcp-'));
 const cp=spawn(process.execPath,['src/mcp-stdio.mjs'],{cwd:process.cwd(),env:{...process.env,RADAR_DB:join(dir,'db.sqlite')},stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:cp.stdout});const iter=lines[Symbol.asyncIterator]();
 try{
  cp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})+'\n');
  const init=JSON.parse((await iter.next()).value);assert.equal(init.result.serverInfo.name,'opportunity-radar');
  cp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n');
  const list=JSON.parse((await iter.next()).value);assert.equal(list.result.tools.length,12);
 }finally{cp.stdin.end();await new Promise(r=>cp.once('exit',r));rmSync(dir,{recursive:true,force:true});}
});
test('tool calls validate required arguments and report disabled tools honestly',()=>{
 const {db,service}=make();
 try{
  const missing=dispatchMcp(service,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'task.claim',arguments:{project_id:'p'}}});
  assert.equal(missing.error.code,-32602);
  assert.match(missing.error.message,/missing required argument/);
  const disabled=dispatchMcp(service,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'collaboration.handoff',arguments:{}}});
  assert.equal(disabled.result.isError,true);
  assert.match(disabled.result.content[0].text,/CAPABILITY_DISABLED/);
  const discover=dispatchMcp(service,{jsonrpc:'2.0',id:3,method:'server/discover'});
  assert.equal(discover.result.serverInfo.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
 }finally{db.close()}
});
