import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {modelConfig,modelDiagnostics,requestModelJSON,probeModel} from '../src/model-transport.mjs';

const env={RADAR_LLM_BASE_URL:'https://api.deepseek.com',RADAR_LLM_API_KEY:'private-deepseek-key',RADAR_LLM_MODEL:'deepseek-chat',
 OPENROUTER_API_KEY:'private-router-key'};
const reply=content=>new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});

test('chat and decisions protocols remain independent; failures never silently call Jev',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url:String(url),body:JSON.parse(opts.body),authorization:opts.headers.Authorization,signal:opts.signal,redirect:opts.redirect});
  if(url.hostname==='api.deepseek.com')return new Response(JSON.stringify({error:{code:'service_unavailable',message:'sensitive prompt and private-deepseek-key'}}),{status:503});
  return new Response(JSON.stringify({answers:{is_problem:{noul:0.9}}}));
 };
 await assert.rejects(probeModel('llm',{env,fetchImpl}),e=>{
  assert.equal(e.code,'LLM_HTTP_ERROR');assert.equal(e.modelCall.provider,'api.deepseek.com');
  assert.equal(e.modelCall.model,'deepseek-chat');assert.equal(e.modelCall.upstreamStatus,503);
  assert.equal(e.modelCall.upstreamCode,'service_unavailable');assert.equal(e.modelCall.timeoutMs,90000);
  assert.ok(!e.message.includes('sensitive prompt'));return true;
 });
 assert.equal(calls.length,1);
 assert.equal((await probeModel('jev',{env,fetchImpl})).ok,true);
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
 assert.equal(calls[1].url,'https://openrouter.ai/api/alpha/decisions');
 assert.equal(calls[1].body.model,'~typesafe/jev-latest');
 assert.equal(calls[1].authorization,'Bearer private-router-key');
 assert.equal(calls[1].redirect,'error');
 assert.ok(calls[1].body.questions);assert.equal(calls[1].body.messages,undefined);
 assert.equal(modelDiagnostics(env).routing.automaticFailover,false);
});

test('diagnostics expose safe codes and request IDs but never raw provider errors, keys, prompts or URL credentials',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'User prompt private-deepseek-key private-router-key'}}),
  {status:429,headers:{'x-request-id':'request-private-deepseek-key'}});
 await assert.rejects(probeModel('llm',{env,fetchImpl}),e=>{
  assert.equal(e.modelCall.upstreamCode,'rate_limit_exceeded');assert.equal(e.modelCall.upstreamRequestId,'request-[redacted]');return true;
 });
 const diagnostic=JSON.stringify(modelDiagnostics(env));
 for(const secret of ['User prompt','private-deepseek-key','private-router-key','Bearer','Reply with exactly'])assert.ok(!diagnostic.includes(secret));
 for(const base of ['https://user:password@example.org','https://example.org/?key=secret','https://example.org/#secret','http://external.example'])
  assert.throws(()=>modelConfig('llm',{...env,RADAR_LLM_BASE_URL:base}),{code:'BAD_LLM_ENDPOINT'});
 const malformed=modelDiagnostics({...env,RADAR_LLM_BASE_URL:'https://user:secret@example.org'});
 assert.equal(malformed.models[0].error,'BAD_LLM_ENDPOINT');assert.ok(!JSON.stringify(malformed).includes('user:secret'));
});

test('invalid timeout values fail before fetch; defaults and explicit limits are independent',async()=>{
 for(const value of ['abc','0','999','180001','1000.1']){
  await assert.rejects(probeModel('llm',{env:{...env,RADAR_LLM_TIMEOUT_MS:value},fetchImpl:()=>assert.fail('must not send')}),{code:'BAD_MODEL_TIMEOUT'});
 }
 const config=modelDiagnostics({...env,RADAR_LLM_TIMEOUT_MS:'120000',JEV_TIMEOUT_MS:'25000'});
 assert.deepEqual(config.models.map(x=>x.timeoutMs),[120000,25000]);
 await assert.rejects(probeModel('wrong',{env}),{code:'BAD_MODEL_KIND'});
});

test('provider authentication failures do not request another Radar Owner Token',async()=>{
 await assert.rejects(probeModel('jev',{env,fetchImpl:async()=>new Response('not json',{status:401})}),
  e=>e.code==='JEV_UNAUTHORIZED'&&e.status===502&&e.modelCall.upstreamStatus===401);
});

test('responded probes still validate content; malformed and truncated outputs are explicit failures',async()=>{
 assert.equal((await probeModel('llm',{env,fetchImpl:async()=>reply('OK')})).ok,true);
 const wrong=await probeModel('llm',{env,fetchImpl:async()=>reply('unrelated')});
 assert.equal(wrong.ok,false);assert.equal(wrong.error,'UNEXPECTED_PROBE_RESPONSE');
 await assert.rejects(probeModel('llm',{env,fetchImpl:async()=>new Response('not json')}),{code:'LLM_INVALID_RESPONSE'});
 await assert.rejects(probeModel('llm',{env,fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'OK'}}]}))}),{code:'LLM_OUTPUT_TRUNCATED'});
 await assert.rejects(probeModel('llm',{env,fetchImpl:async()=>{throw new TypeError('private-router-key');}}),e=>e.code==='LLM_UNAVAILABLE'&&!e.message.includes('private-router-key'));
});

test('deadline includes a stalled HTTP response body and records the actual configured timeout',async()=>{
 const timers=[];
 const server=http.createServer((req,res)=>{
  req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.write('{');
  timers.push(setTimeout(()=>res.end('}'),4000));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const started=Date.now();
 try{
  await assert.rejects(requestModelJSON({env:{...env,RADAR_LLM_BASE_URL:'http://127.0.0.1:'+server.address().port,RADAR_LLM_TIMEOUT_MS:'1000'},payload:{messages:[]}}),e=>{
   assert.equal(e.code,'LLM_TIMEOUT');assert.equal(e.status,504);assert.equal(e.modelCall.timeoutMs,1000);
   assert.ok(e.modelCall.elapsedMs>=900);assert.equal(e.modelCall.upstreamStatus,200);return true;
  });
  assert.ok(Date.now()-started<3500);
 }finally{timers.forEach(clearTimeout);server.closeAllConnections();await new Promise(r=>server.close(r));}
});
