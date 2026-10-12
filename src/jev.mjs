// Jev System One 适配层：结构化判定模型（非 LLM），三种题型 Noul / Choice / Score。
// 协议：POST https://openrouter.ai/api/alpha/decisions
//   body: { model, state, questions: {name: {type, instructions, criteria}} }
//   response: { answers: {name: {noul|choice|score, ...}} }
// 与 LLM 的分工：LLM 做总结/发现/起草；Jev 做快速判断（信号过滤、聚类确认、质量评分）。
// Jev 判定永远只是参考信号——不替代人工验收、不改变项目状态、不宣布机会已验证。
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});

export const JEV_DEFAULT_URL='https://openrouter.ai/api/alpha/decisions';
export const JEV_DEFAULT_MODEL='~typesafe/jev-latest';

export function jevConfig(env=process.env){
 const apiKey=env.JEV_API_KEY||env.OPENROUTER_API_KEY||'';
 const apiUrl=env.JEV_API_URL||JEV_DEFAULT_URL;
 const model=env.JEV_MODEL||JEV_DEFAULT_MODEL;
 return {apiKey,apiUrl,model,configured:Boolean(apiKey)};
}

/** Jev System One 通用调用。
 * state：被评判的输入（string|object）。
 * questions：命名问题字典，每个 {type,instructions,criteria}。
 *   - noul  criteria: {"true":"是…","false":"否…"}
 *   - choice criteria: {"选项名":"描述",…}
 *   - score criteria: ["级别1","级别2",…]
 * fetchImpl 可注入用于测试。返回 {answers:{name:{…}}}。 */
export async function jevSystemOne(state,questions,{apiKey,apiUrl=JEV_DEFAULT_URL,model=JEV_DEFAULT_MODEL,fetchImpl=globalThis.fetch,siteUrl,siteName}={}){
 if(!apiKey)throw fail('JEV_NOT_CONFIGURED','JEV_API_KEY 未配置，无法调用 Jev System One',503);
 if(!state)throw fail('BAD_REQUEST','state 不能为空');
 if(!questions||!Object.keys(questions).length)throw fail('BAD_REQUEST','questions 不能为空');
 const headers={'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`};
 if(siteUrl)headers['HTTP-Referer']=siteUrl;
 if(siteName)headers['X-OpenRouter-Title']=siteName;
 const response=await fetchImpl(apiUrl,{
  method:'POST',headers,
  body:JSON.stringify({model,state,questions}),
  signal:AbortSignal.timeout(15000),
 });
 if(!response.ok){
  const text=await response.text().catch(()=>'');
  const code=response.status===401?'JEV_UNAUTHORIZED':response.status===402?'JEV_OUT_OF_CREDITS':'JEV_HTTP_ERROR';
  throw fail(code,`Jev 请求失败（HTTP ${response.status}）：${text.slice(0,200)}`,response.status>=500?502:response.status);
 }
 const data=await response.json();
 const answers=data?.answers;
 if(!answers)throw fail('JEV_BAD_RESPONSE','Jev 返回缺少 answers',502);
 return answers;
}

/** 从 Jev answers 中提取指定问题的判定值和概率。 */
export function extractAnswer(answers,name){
 const a=answers?.[name];
 if(!a)return null;
 if(a.noul!==undefined)return {type:'noul',value:a.noul,probability:a.noul};
 if(a.choice!==undefined)return {type:'choice',value:a.choice,probability:a.confidence??a.probabilities?.[a.choice]??null};
 if(a.score!==undefined)return {type:'score',value:a.score,probability:null};
 return null;
}
