import {createHash,randomUUID} from 'node:crypto';
import {modelConfig} from './model-transport.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const POLICY='home-analysis-checkpoint-v1';
export function homeSourceFingerprint(store,candidate){
 return digest({id:candidate.id,title:candidate.title,sourceUrls:candidate.sourceUrls,
  sources:(candidate.signalIds||[]).map(id=>{const s=store.get('sources',id);return s?{id:s.id,title:s.title,description:s.description,url:s.url,
   revision:s.revision,publishedAt:s.publishedAt,status:s.status}:null;})});
}
function contextKey(store,env){
 const llm=modelConfig('llm',env),config=llm.configured?llm:modelConfig('jev',env);
 if(!config.configured)return null;
 // Store the digest, never the URL, API key or calibration text. Key rotations
 // and timeout settings do not change the meaning of completed work.
 return digest({policy:POLICY,kind:config.kind,endpoint:config.endpoint.href,model:config.model,
  feedback:store.list('home_opportunity_feedback').map(x=>({id:x.id,revision:x.revision,verdict:x.verdict,reason:x.reason})).sort((a,b)=>a.id.localeCompare(b.id))});
}
/** A normal scan starts a new checkpoint; an explicit retry resumes only exact inputs. */
export function homeAnalysisRun(store,candidates,{env,retryIncomplete=false,onProgress}={}){
 const context=contextKey(store,env),fingerprints=new Map(candidates.map(c=>[c.id,homeSourceFingerprint(store,c)]));
 const old=store.get('home_analysis_checkpoints','latest');
 const entries=new Map(retryIncomplete&&context&&old?.policy===POLICY&&old?.context===context?(old.entries||[]).filter(x=>fingerprints.get(x.id)===x.sourceFingerprint).map(x=>[x.id,x]):[]);
 const reused=new Set(entries.keys());
 const notify=()=>{
  if(!onProgress)return;
  const valid=[...entries.values()].filter(x=>candidates.some(c=>c.id===x.id&&x.sourceFingerprint===homeSourceFingerprint(store,c))&&contextKey(store,env)===context);
  onProgress({total:candidates.length,classified:valid.length,pending:candidates.length-valid.length,reused:valid.filter(x=>reused.has(x.id)).length});
 };
 const save=()=>{
  const row=store.get('home_analysis_checkpoints','latest');
  store.put('home_analysis_checkpoints',{id:'latest',policy:POLICY,context,entries:[...entries.values()]},row?.revision||0);
 };
 if(context)save();notify();
 return {results:new Map([...entries].map(([id,x])=>[id,x.result])),reused,fingerprints,
  current:()=>contextKey(store,env)===context,
  isCurrent:candidate=>fingerprints.get(candidate.id)===homeSourceFingerprint(store,candidate),
  accept(candidate,result){
   if(!context||contextKey(store,env)!==context||fingerprints.get(candidate.id)!==homeSourceFingerprint(store,candidate))return null;
   const checked={...result,analysisId:randomUUID(),analyzedAt:new Date().toISOString(),sourceFingerprint:fingerprints.get(candidate.id)};
   entries.set(candidate.id,{id:candidate.id,sourceFingerprint:checked.sourceFingerprint,result:checked});save();notify();return checked;
  }};
}
