// 模型预筛（Model pre-filter）：LLM 只做第一道降噪过滤，不做任何判断结论。
// 设计纪律（与产品宪章一致）：
// - 默认关闭；owner 在界面显式开启，且需已配置 LLM（RADAR_LLM_*）。
// - 只作用于「扫描新进」的信号；手动录入是 owner 显式动作，永不参与。
// - 只有 verdict=noise 会被自动忽略并记录理由（模型过滤）；keep 照常进入待研判队列。
// - 拿不准一律 keep（宁可多留人工）；LLM 出错/超时一律放行（fail-open），绝不因模型故障丢信号。
// - 每条被过滤的信号带 triageBy:'model_filter' + filterReason，全量可在「模型过滤记录」里查看与恢复。
import {randomUUID} from 'node:crypto';

const now=()=>new Date().toISOString();
const clean=(v,max)=>String(v??'').trim().slice(0,max);
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const CONFIG_ID='config';
export const MODEL_FILTER_LIMIT_NOTE='模型预筛需要先配置 RADAR_LLM_BASE_URL / RADAR_LLM_API_KEY / RADAR_LLM_MODEL。';

export function modelFilterConfig(store){
 const c=store.get('model_filter',CONFIG_ID);
 return {enabled:c?.enabled===true,updatedAt:c?.updatedAt||null};
}
export function setModelFilterEnabled(store,enabled){
 const item=store.put('model_filter',{id:CONFIG_ID,enabled:enabled===true,updatedAt:now()});
 store.event('model_filter.toggled',CONFIG_ID,'owner',{enabled:item.enabled});
 return modelFilterConfig(store);
}
export function llmConfigured(env=process.env){
 return Boolean(env.RADAR_LLM_BASE_URL&&env.RADAR_LLM_API_KEY&&env.RADAR_LLM_MODEL);
}

/** 对候选信号批量调用 LLM 预筛，返回 Map<candidateId,{verdict,reason,model}>。
 * 只包含 noise 判定；解析失败/超时按整体放行处理（调用方收到空 Map）。
 * fetchImpl 可注入用于测试。 */
export async function classifyWithModel(candidates,{baseUrl,apiKey,model,fetchImpl=globalThis.fetch}={}){
 if(!candidates.length)return new Map();
 const numbered=candidates.map((c,i)=>({id:String(i),title:clean(c.title,300),description:clean(c.description,300)}));
 const system=['你是信息预筛助手。逐条判断信息是否描述普通用户/消费者遇到的具体问题、工具或产品的使用摩擦、未满足的需求（一手经验优先）。',
  '以下情况判为 noise：招聘求职、广告赞助、纯产品公告或新闻稿、优惠促销、与产品使用无关的闲聊、纯技术教程且无用户摩擦。',
  '拿不准时一律判 keep（宁可多留给人工）。只能依据文本本身判断，不得臆测未提及的内容。',
  'reason 用不超过 40 字的中文并引用文本依据。只输出严格的 JSON 数组：[{"id":"…","verdict":"noise"或"keep","reason":"…"}]，不要输出任何其他文字。'].join('');
 const payload={model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(numbered)}]};
 const response=await fetchImpl(`${baseUrl.replace(/\/+$/,'')}/chat/completions`,{
  method:'POST',signal:AbortSignal.timeout(30000),
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
  body:JSON.stringify(payload)});
 if(!response.ok||!response.text)throw fail('LLM_HTTP_ERROR',`LLM 预筛请求失败：HTTP ${response.status}`,502);
 const text=await response.text();
 let parsed;try{parsed=JSON.parse(text);}catch{throw fail('LLM_BAD_RESPONSE','LLM 返回的不是有效 JSON',502);}
 const content=parsed?.choices?.[0]?.message?.content??'';
 const arrStart=content.indexOf('['),arrEnd=content.lastIndexOf(']');
 if(arrStart<0||arrEnd<=arrStart)throw fail('LLM_BAD_RESPONSE','LLM 预筛返回缺少 JSON 数组',502);
 let verdicts;try{verdicts=JSON.parse(content.slice(arrStart,arrEnd+1));}catch{throw fail('LLM_BAD_RESPONSE','LLM 预筛返回的 JSON 无法解析',502);}
 const assignments=new Map();
 for(const v of Array.isArray(verdicts)?verdicts:[]){
  const idx=Number(v?.id);
  if(!Number.isInteger(idx)||idx<0||idx>=candidates.length)continue;
  assignments.set(String(idx),{verdict:v.verdict==='noise'?'noise':'keep',reason:clean(v.reason,80),model});
 }
 return assignments;
}

/** 扫描摄入的预筛编排：enabled 且 LLM 已配置时，把待研判候选分批交给模型。
 * 返回 {assignments:Map<id,meta>, scanned, modelFiltered}；assignments 只含 noise。 */
export async function filterNewCandidates(store,candidates,{fetchImpl=globalThis.fetch}={}){
 const assignments=new Map();
 if(!candidates.length)return {assignments,scanned:0,modelFiltered:0};
 const config=modelFilterConfig(store);
 if(!config.enabled)return {assignments,scanned:candidates.length,modelFiltered:0};
 if(!llmConfigured())return {assignments,scanned:candidates.length,modelFiltered:0};
 const baseUrl=process.env.RADAR_LLM_BASE_URL,apiKey=process.env.RADAR_LLM_API_KEY,model=process.env.RADAR_LLM_MODEL;
 const CHUNK=20;
 try{
  for(let i=0;i<candidates.length;i+=CHUNK){
   const chunk=candidates.slice(i,i+CHUNK);
   const result=await classifyWithModel(chunk,{baseUrl,apiKey,model,fetchImpl});
   for(const [idx,meta] of result){
    const target=chunk[Number(idx)];
    if(!target)continue;
    if(meta.verdict==='noise')assignments.set(target.key,{verdict:'noise',reason:meta.reason,model:meta.model});
   }
  }
 }catch(e){
  // fail-open：模型预筛失败绝不丢信号——全部按未过滤进入待研判队列，并留审计事件。
  store.event('signal.model_filter.error',CONFIG_ID,'system',{message:e.message},null);
  return {assignments:new Map(),scanned:candidates.length,modelFiltered:0,failOpen:true};
 }
 return {assignments,scanned:candidates.length,modelFiltered:[...assignments.values()].filter(x=>x.verdict==='noise').length};
}

/** 模型过滤记录：被模型忽略的信号（含已恢复的），供 owner 追踪与复核。 */
export function modelFilterRecords(store){
 const items=store.list('sources').filter(x=>x.triageBy==='model_filter')
  .sort((a,b)=>(b.filterAt||'').localeCompare(a.filterAt||''))
  .slice(0,100)
  .map(x=>({id:x.id,title:x.title,url:x.url,status:x.status,
   reason:x.filterReason||'',model:x.filterModel||'',
   filteredAt:x.filterAt||null,restored:x.status!=='dismissed',revision:x.revision}));
 return {items,
  counts:{total:items.length,dismissed:items.filter(x=>x.status==='dismissed').length,
   restored:items.filter(x=>x.status!=='dismissed').length},
  note:'模型预筛只做降噪过滤，不做任何判断结论；每条都可恢复，恢复记录同样留痕。'};
}
export function recordModelFilterMeta(candidateMeta,verdictResult){
 return {verdict:'noise',reason:verdictResult.reason,model:verdictResult.model};
}
