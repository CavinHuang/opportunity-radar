import {randomUUID} from 'node:crypto';

const recent=[];
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const defaults={llm:90000,jev:15000};
const safeCode=/^[a-zA-Z0-9_.:-]{1,80}$/;
const safeCodes=new Set(['invalid_api_key','authentication_error','insufficient_quota','insufficient_balance','rate_limit_exceeded','rate_limit_error','model_not_found','invalid_request_error','server_error','service_unavailable','provider_error','overloaded_error','timeout','401','402','403','404','429','500','502','503','504']);
function redact(value,env){
 let out=String(value??'');
 for(const [name,secret] of Object.entries(env))if(/KEY|TOKEN|SECRET|PASSWORD/.test(name)&&secret)out=out.split(String(secret)).join('[redacted]');
 return out.slice(0,160);
}
export function modelConfig(kind='llm',env=process.env){
 if(!['llm','jev'].includes(kind))throw fail('BAD_MODEL_KIND','只能检查 llm 或 jev');
 const isJev=kind==='jev',prefix=isJev?'JEV':'LLM';
 const key=isJev?env.JEV_API_KEY||env.OPENROUTER_API_KEY:env.RADAR_LLM_API_KEY;
 const model=isJev?env.JEV_MODEL||'~typesafe/jev-latest':env.RADAR_LLM_MODEL;
 const base=isJev?env.JEV_API_URL||'https://openrouter.ai/api/alpha/decisions':env.RADAR_LLM_BASE_URL;
 const configured=Boolean(key&&model&&base);
 const rawTimeout=isJev?env.JEV_TIMEOUT_MS:env.RADAR_LLM_TIMEOUT_MS;
 const timeoutMs=rawTimeout===undefined||rawTimeout===''?defaults[kind]:Number(rawTimeout);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)
  throw fail('BAD_MODEL_TIMEOUT','模型超时必须是 1000 至 180000 毫秒的整数');
 if(!configured)return {kind,configured:false,model:redact(model,env),timeoutMs,prefix};
 let endpoint;
 try{endpoint=new URL(isJev?base:base.replace(/\/+$/,'')+'/chat/completions');}catch{throw fail('BAD_LLM_ENDPOINT','无效模型地址');}
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))
  throw fail('BAD_LLM_ENDPOINT','模型地址需使用 HTTPS，且不能包含凭据、查询参数或片段');
 return {kind,prefix,configured:true,key,model,endpoint,timeoutMs,
  public:{kind,configured:true,provider:redact(endpoint.hostname,env),model:redact(model,env),timeoutMs}};
}
export function modelDiagnostics(env=process.env){
 const config=kind=>{try{const c=modelConfig(kind,env);return c.public||{kind,configured:false,model:c.model,timeoutMs:c.timeoutMs};}
 catch(e){return {kind,configured:false,error:e.code,message:e.message};}};
 return {models:[config('llm'),config('jev')],routing:{signalPrefilter:'jev when configured; otherwise llm',homeAnalysis:'llm when configured; otherwise jev',evidenceComparison:'llm only',automaticFailover:false},
  recent:recent.map(x=>({...x})),notice:'仅记录本进程最近40次调用的元数据，不保存密钥、请求正文或上游原始错误。响应成功不代表研究结论已通过核查。探测只验证最小请求，不能替代真实任务验收。'};
}
// Read only a bounded error payload. Never return raw provider messages: they
// may echo credentials, prompts or internal gateway HTML. Retain known codes.
async function upstreamCode(response,signal){
 try{
  let raw='';
  if(response.body?.getReader){
   const reader=response.body.getReader();let count=0;
   try{while(count<8192){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;count+=value.length;raw+=new TextDecoder().decode(value);}}
   finally{await reader.cancel().catch(()=>{});}
  }else if(response.text)raw=(await response.text()).slice(0,8192);
  const data=JSON.parse(raw),code=String(data?.error?.code??data?.error?.type??'');
  return safeCodes.has(code)?code:null;
 }catch{return null;}
}
/** One request, one deadline (including response body); never silently switches models. */
export async function requestModelJSON({kind='llm',env=process.env,payload,fetchImpl=globalThis.fetch,operation='request',headers={}}={}){
 const c=modelConfig(kind,env);
 if(!c.configured)throw fail(c.prefix+'_NOT_CONFIGURED','尚未配置'+(kind==='jev'?' Jev':'研究模型')+'，请核对服务端环境变量',503);
 const trace={id:randomUUID(),...c.public,operation,startedAt:new Date().toISOString(),status:'pending'};
 const started=Date.now(),signal=AbortSignal.timeout(c.timeoutMs);
 const finish=()=>{trace.elapsedMs=Date.now()-started;recent.unshift({...trace});recent.splice(40);};
 try{
  const response=await fetchImpl(c.endpoint,{method:'POST',redirect:'error',headers:{...headers,'Content-Type':'application/json',Authorization:'Bearer '+c.key},body:JSON.stringify({...payload,model:c.model}),signal});
  trace.upstreamStatus=response.status??200;
  const requestId=response.headers?.get?.('x-request-id')||response.headers?.get?.('request-id');
  if(requestId&&safeCode.test(requestId))trace.upstreamRequestId=redact(requestId,env);
  if(!response.ok){
   trace.upstreamCode=await upstreamCode(response,signal);
   const detail={401:'鉴权失败，请核对密钥',402:'额度或余额不足',403:'访问被拒绝',404:'接口或模型不存在',429:'请求受限',503:'上游暂时无法处理请求'}[response.status]||'上游请求失败';
   const code=kind==='jev'&&response.status===401?'JEV_UNAUTHORIZED':kind==='jev'&&response.status===402?'JEV_OUT_OF_CREDITS':c.prefix+'_HTTP_ERROR';
   // Upstream 401 is not an expired Radar Owner Token. Never trigger the UI's
   // owner-login flow for a provider authentication failure.
   throw fail(code,`模型请求失败 HTTP ${response.status}：${detail}`,502);
  }
  const data=await response.json();signal.throwIfAborted();
  if(data?.error){trace.upstreamCode=safeCodes.has(String(data.error.code))?String(data.error.code):null;throw fail(c.prefix+'_HTTP_ERROR','模型接口返回错误，未得到有效响应',502);}
  if(kind==='llm'&&data?.choices?.[0]?.finish_reason==='length')throw fail('LLM_OUTPUT_TRUNCATED','模型输出被截断，未保存新草稿，请减少输入或重试',502);
  trace.status='responded';finish();return {data,trace:{...trace}};
 }catch(e){
  let error=e;
  if(!e.code||!e.status){
   error=e.name==='TimeoutError'||e.name==='AbortError'||signal.aborted?fail(c.prefix+'_TIMEOUT',`模型响应超时（${c.timeoutMs/1000}秒），未保存新草稿；可稍后重试`,504):
    e instanceof SyntaxError?fail(c.prefix+'_INVALID_RESPONSE','模型服务返回了无效 JSON，未保存新草稿',502):fail(c.prefix+'_UNAVAILABLE','暂时无法连接模型，未保存新草稿',502);
  }
  trace.status='failed';trace.error=error.code;finish();error.modelCall={...trace};
  error.message+=`（${trace.provider} / ${trace.model}；调用 ${trace.id}）`;
  throw error;
 }
}

export async function probeModel(kind,{env=process.env,fetchImpl=globalThis.fetch}={}){
 const payload=kind==='jev'?{state:'A user cannot import a CSV file.',questions:{is_problem:{type:'noul',instructions:'Does this state describe a user problem?',criteria:{true:'A problem',false:'No problem'}}}}:
  {messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:8,temperature:0};
 const {data,trace}=await requestModelJSON({kind,env,fetchImpl,payload,operation:'connectivity_probe'});
 const valid=kind==='jev'?typeof data?.answers?.is_problem?.noul==='number'&&Number.isFinite(data.answers.is_problem.noul)&&data.answers.is_problem.noul>=0&&data.answers.is_problem.noul<=1:
  typeof data?.choices?.[0]?.message?.content==='string'&&data.choices[0].message.content.trim()==='OK';
 return {ok:valid,modelCall:trace,...(!valid?{error:'UNEXPECTED_PROBE_RESPONSE'}:{}),notice:'仅测试最小协议响应，不修改研究或审核记录，也不证明真实任务质量。'};
}
