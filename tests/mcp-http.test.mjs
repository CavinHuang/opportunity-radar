import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'radar-mcp-http-'));
process.env.RADAR_DB=join(dir,'db.sqlite');
process.env.RADAR_AGENT_TOKEN='mcp-test-agent';
const {createServer}=await import('../src/server.mjs');
test('MCP HTTP requires agent auth and modern request metadata',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/mcp`;
 const params={_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test-client',version:'1.0'},'io.modelcontextprotocol/clientCapabilities':{}}};
 const payload={jsonrpc:'2.0',id:14,method:'tools/list',params};
 const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'};
 try{
  const noAuth=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(noAuth.status,401);
  const withAuth={...headers,Authorization:'Bearer mcp-test-agent'};
  const good=await fetch(url,{method:'POST',headers:withAuth,body:JSON.stringify(payload)});
  assert.equal(good.status,200);assert.equal((await good.json()).result.tools.length,12);
  const mismatch=await fetch(url,{method:'POST',headers:{...withAuth,'Mcp-Method':'ping'},body:JSON.stringify(payload)});
  assert.equal(mismatch.status,400);assert.equal((await mismatch.json()).error.code,-32020);
 }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
