import {createHash} from 'node:crypto';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const digest=x=>createHash('sha256').update(x).digest('hex').slice(0,24);
const enStop=new Set('about after again anyone are asking best can could does dont finding find for from have help how its looking more need new not problem question some someone their there these this those want what when where which while with without would your'.split(' '));
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase()
 .replace(/^(?:ask hn|ask v2ex|q:|question:|求助|请问)\s*[:：·—-]?\s*/u,'')
 .replace(/https?:\/\/\S+/g,' ').replace(/[\p{P}\p{S}]+/gu,' ').replace(/\s+/g,' ').trim();
export function problemTokens(title){
 const src=normalize(title);
 const result=new Set();
 for(const word of src.match(/[a-z]{3,}/g)||[]){
  const token=word.length>=6&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word;
  if(!enStop.has(token))result.add(token);
 }
 for(const block of src.match(/[\p{Script=Han}]{2,}/gu)||[]){
  if(block.length>=2)for(let i=0;i<block.length-1;i++)result.add(block.slice(i,i+2));
 }
 return result;
}
export function titleSimilarity(a,b){
 const aa=problemTokens(a),bb=problemTokens(b);
 if(aa.size<3||bb.size<3)return 0;
 const common=[...aa].filter(x=>bb.has(x)).length;
 if(common<3)return 0;
 return common/(aa.size+bb.size-common);
}
const host=raw=>{try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,'')}catch{return 'unknown'}};
const idSort=(a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id);
function groupsFrom(store,{maxSignals=600}={}){
 const eligible=store.list('sources').filter(s=>
   (s.status==='new'||s.status==='saved')&&s.url?.startsWith('https://')&&s.title&&s.id);
 const queue=eligible.slice(0,maxSignals).sort(idSort);
 const groups=[];
 for(const signal of queue){
  if(problemTokens(signal.title).size<3)continue;
  let best=null,weight=0;
  for(const group of groups){
   if(group.members.length>=8)continue;
   // Every pair must be strongly similar: avoids transitive A~B~C false clusters.
   const scores=group.members.map(m=>titleSimilarity(m.title,signal.title));
   const minimum=Math.min(...scores);
   if(minimum>=0.58&&minimum>weight){best=group;weight=minimum;}
  }
  if(best)best.members.push(signal);
  else groups.push({members:[signal]});
 }
 return {groups:groups.filter(x=>x.members.length>=2),examined:queue.length,unexamined:Math.max(0,eligible.length-queue.length)};
}
export function discoveryClusters(store,{includeDismissed=false,limit=12,maxSignals=600}={}){
 if(!Number.isInteger(limit)||limit<1||limit>40)throw fail('BAD_LIMIT','每页候选组必须是 1–40');
 const {groups,examined,unexamined}=groupsFrom(store,{maxSignals});
 const candidates=groups.map(g=>{
  const members=[...g.members].sort(idSort);
  const seedId=members[0].id;
  const fingerprint=digest(members.map(s=>s.id).sort().join('|'));
  const decision=store.get('discovery_reviews',seedId);
  const dismissed=decision?.status==='dismissed'&&decision.fingerprint===fingerprint;
  const domains=[...new Set(members.map(x=>host(x.url)))];
  const names=[...new Set(members.map(x=>x.author?host(x.url)+'|'+x.author.toLowerCase():'unattributed:'+x.id))];
  return {id:seedId,fingerprint,representativeTitle:members[0].title,
   signalCount:members.length,domainCount:domains.length,domains,
   attributedAuthorKeys:names.length,lastSeenAt:members.map(x=>x.createdAt).sort().at(-1)||null,
   state:dismissed?'dismissed':'needs_review',dismissReason:dismissed?decision.reason:null,
   signals:members.map(s=>({id:s.id,title:s.title,url:s.url,author:s.author||null,
     description:String(s.description||'').slice(0,320),market:s.market||'',status:s.status,
     domain:host(s.url),createdAt:s.createdAt})),
   caveat:'只按公开标题的词汇相似性归组：可能是转载、同作者或不同问题；不能把帖子数量当成独立消费者人数，也不能证明付费意愿。'};
 }).sort((a,b)=>b.domainCount-a.domainCount||b.signalCount-a.signalCount||
   String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))||a.id.localeCompare(b.id));
 const visible=includeDismissed?candidates:candidates.filter(x=>x.state!=='dismissed');
 return {items:visible.slice(0,limit),total:visible.length,stats:{
   examinedSignals:examined,unexaminedSignals:unexamined,proposedGroups:candidates.length,
   dismissedGroups:candidates.filter(x=>x.state==='dismissed').length,
   withMultipleDomains:candidates.filter(x=>x.domainCount>1).length},
  generatedAt:new Date().toISOString(),policy:'Candidate title similarity only; human inspection of originals and independent consumer validation are required.'};
}
export function reviewDiscoveryCluster(store,id,{action,fingerprint,reason='',expected_revision}={}){
 if(!['dismiss','restore'].includes(action))throw fail('BAD_REVIEW','请选择忽略或恢复候选组');
 if(typeof fingerprint!=='string'||!/^[a-f0-9]{24}$/.test(fingerprint))
  throw fail('BAD_REVIEW','必须提交当前候选组版本');
 const groups=discoveryClusters(store,{includeDismissed:true,limit:40});
 const group=groups.items.find(x=>x.id===id);
 if(!group)throw fail('NOT_FOUND','候选组不存在或已不满足聚合条件',404);
 if(group.fingerprint!==fingerprint)throw fail('CLUSTER_CHANGED','候选组新增或减少了信号，请刷新',409);
 if(action==='dismiss'&&(String(reason).trim().length<10||String(reason).trim().length>500))
  throw fail('REVIEW_REASON_REQUIRED','忽略候选组需要 10–500 字的核查理由');
 const existing=store.get('discovery_reviews',id);
 if(expected_revision!==undefined&&expected_revision!==(existing?.revision||0))
  throw fail('REVISION_CONFLICT','候选组已被其他操作修改',409);
 return store.transaction(()=>{
  const fresh=store.get('discovery_reviews',id);
  if(expected_revision!==undefined&&expected_revision!==(fresh?.revision||0))
   throw fail('REVISION_CONFLICT','候选组已被其他操作修改',409);
  const row=store.put('discovery_reviews',{id,status:action==='dismiss'?'dismissed':'active',
   fingerprint,reason:action==='dismiss'?String(reason).trim():null,
   reviewedBy:'owner',reviewedAt:new Date().toISOString()},fresh?.revision||0);
  store.event('discovery.cluster.reviewed',id,'owner',{action,fingerprint,count:group.signalCount});
  return row;
 });
}
