// Jev System One 适配层：结构化判定模型（非 LLM），三种题型 Noul / Choice / Score。
// 协议：POST state + typed questions → typed decisions with calibrated probabilities。
// 与 LLM 的分工：LLM 做总结/发现/起草；Jev 做快速判断（信号过滤、聚类确认、质量评分）。
// Jev 判定永远只是参考信号——不替代人工验收、不改变项目状态、不宣布机会已验证。
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});

export const JEV_DEFAULT_URL='https://openrouter.ai/~typesafe/jev-latest';

export function jevConfig(env=process.env){
 const apiKey=env.JEV_API_KEY||'';
 const apiUrl=env.JEV_API_URL||JEV_DEFAULT_URL;
 return {apiKey,apiUrl,configured:Boolean(apiKey)};
}

/** Jev System One 通用调用。state 是被评判的输入（string|object），
 * questions 是命名问题字典（noul/choice/score），返回 {answers:{name:{...}}}。
 * fetchImpl 可注入用于测试。 */
export async function jevSystemOne(state,questions,{apiKey,apiUrl=JEV_DEFAULT_URL,fetchImpl=globalThis.fetch,model}={}){
 if(!apiKey)throw fail('JEV_NOT_CONFIGURED','JEV_API_KEY 未配置，无法调用 Jev System One',503);
 if(!state)throw fail('BAD_REQUEST','state 不能为空');
 if(!questions||!Object.keys(questions).length)throw fail('BAD_REQUEST','questions 不能为空');
 const body={state,questions};
 if(model)body.model=model;
 const endpoint=/\/systemone\/?$/.test(apiUrl)||apiUrl===JEV_DEFAULT_URL?apiUrl:apiUrl.replace(/\/+$/,'')+'/systemone';
 const response=await fetchImpl(endpoint,{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
  body:JSON.stringify(body),
  signal:AbortSignal.timeout(15000),
 });
 if(!response.ok){
  const text=await response.text().catch(()=>'');
  const code=response.status===401?'JEV_UNAUTHORIZED':response.status===402?'JEV_OUT_OF_CREDITS':'JEV_HTTP_ERROR';
  throw fail(code,`Jev System One 请求失败（HTTP ${response.status}）：${text.slice(0,200)}`,response.status>=500?502:response.status);
 }
 const data=await response.json();
 const result=data?.results?.[0];
 if(!result)throw fail('JEV_BAD_RESPONSE','Jev System One 返回缺少 results',502);
 return result;
}

/** 便捷方法：从 Jev result 中提取指定问题的判定值和置信度。 */
export function extractAnswer(result,name){
 const a=result?.answers?.[name];
 if(!a)return null;
 if(a.type==='noul')return {type:'noul',value:a.noul,probability:a.noul};
 if(a.type==='choice')return {type:'choice',value:a.choice,probability:a.confidence??null};
 if(a.type==='score')return {type:'score',value:a.score,legend:a.legend??null,probability:null};
 return {type:a.type,value:null,probability:null};
}
