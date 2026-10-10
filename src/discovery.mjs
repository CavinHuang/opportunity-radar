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
const normalizeBody=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
// Warning indicators only: neither matching text nor an author label verifies identity.
export function groupDiagnostics(members){
 const domains=[...new Set(members.map(s=>host(s.url)))];
 const commonTokens=members.map(s=>problemTokens(s.title))
   .reduce((acc,set)=>new Set([...acc].filter(x=>set.has(x))));
 const pairSimilarity=[];
 for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++)
   pairSimilarity.push(titleSimilarity(members[i].title,members[j].title));
 const reasons=[];
 const duplicates=values=>values.length-new Set(values).size;
 if(duplicates(members.map(x=>normalize(x.title)))>0)reasons.push('identical_titles');
 const bodies=members.map(x=>normalizeBody(x.description)).filter(x=>x.length>=60);
 if(duplicates(bodies)>0)reasons.push('identical_summaries');
 const attributed=members.filter(x=>x.author).map(x=>host(x.url)+'|'+String(x.author).trim().toLowerCase());
 if(duplicates(attributed)>0)reasons.push('repeated_attributed_author');
 return {possibleRepost:reasons.length>0,possibleRepostReasons:reasons,
   minimumTitleSimilarity:Math.min(...pairSimilarity),sharedTerms:[...commonTokens].sort().slice(0,12),
   siteCount:domains.length,
   warning:reasons.length?'重复标题、内容或署名提示可能转载/重复发帖；不能据此确定原文独立性':'标题相似不能证明来源独立，仍需核查原文与作者'};
}

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
 if(!Number.isInteger(limit)||limit<1||limit>300)throw fail('BAD_LIMIT','每页候选组必须是 1–300');
 const {groups,examined,unexamined}=groupsFrom(store,{maxSignals});
 const candidates=groups.map(g=>{
  const members=[...g.members].sort(idSort);
  const seedId=members[0].id;
  const fingerprint=digest(members.map(s=>s.id).sort().join('|'));
  const decision=store.get('discovery_reviews',seedId);
  const dismissed=decision?.status==='dismissed'&&decision.fingerprint===fingerprint;
  const domains=[...new Set(members.map(x=>host(x.url)))];
  const names=[...new Set(members.map(x=>x.author?host(x.url)+'|'+x.author.toLowerCase():'unattributed:'+x.id))];
  const diagnostics=groupDiagnostics(members);
  const matchingReview=decision?.fingerprint===fingerprint?decision:null;
  const state=dismissed?'dismissed':matchingReview?.status==='reviewed_related'?'reviewed_related':'needs_review';
  return {id:seedId,fingerprint,representativeTitle:members[0].title,
   signalCount:members.length,domainCount:domains.length,domains,
   attributedAuthorKeys:names.length,lastSeenAt:members.map(x=>x.createdAt).sort().at(-1)||null,
   state,dismissReason:dismissed?decision.reason:null,
   reviewClass:matchingReview?.classification||null,reviewNote:matchingReview?.reason||null,
   reviewRevision:matchingReview?.revision||0,diagnostics,
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
   withMultipleDomains:candidates.filter(x=>x.domainCount>1).length,
   possibleReposts:candidates.filter(x=>x.diagnostics.possibleRepost).length,
   ownerLabeledCurrent:candidates.filter(x=>x.state==='dismissed'||x.state==='reviewed_related').length,
   ownerMarkedRelated:candidates.filter(x=>x.state==='reviewed_related').length,
   ownerDismissedAsDifferent:candidates.filter(x=>x.state==='dismissed'&&x.reviewClass==='different_problem').length,
   ownerDismissedAsRepost:candidates.filter(x=>x.state==='dismissed'&&x.reviewClass==='possible_repost').length},
  generatedAt:new Date().toISOString(),policy:'Candidate title similarity only; human inspection of originals and independent consumer validation are required.'};
}
/** Resolve a current membership signature before any Owner-approved bulk association.
 * All members are stored as UNREVIEWED evidence; lexical similarity is not validation. */
export function currentDiscoveryGroup(store,id,fingerprint){
 const current=discoveryClusters(store,{includeDismissed:true,limit:300}).items.find(g=>g.id===id);
 if(!current)throw fail('NOT_FOUND','候选组已不存在或不满足聚合条件',404);
 if(current.fingerprint!==fingerprint)throw fail('CLUSTER_CHANGED','候选组内容已更新，请刷新再确认',409);
 if(current.state==='dismissed')throw fail('CLUSTER_DISMISSED','请先恢复已忽略的候选组',409);
 return current;
}
export const DISMISS_CLASSES=Object.freeze(['possible_repost','different_problem','not_consumer_problem','other']);
export function reviewDiscoveryCluster(store,id,{action,fingerprint,reason='',classification,expected_revision}={}){
 if(!['dismiss','restore','confirm'].includes(action))throw fail('BAD_REVIEW','请选择确认同一问题、忽略或恢复候选组');
 if(typeof fingerprint!=='string'||!/^[a-f0-9]{24}$/.test(fingerprint))
  throw fail('BAD_REVIEW','必须提交当前候选组版本');
 const groups=discoveryClusters(store,{includeDismissed:true,limit:300});
 const group=groups.items.find(x=>x.id===id);
 if(!group)throw fail('NOT_FOUND','候选组不存在或已不满足聚合条件',404);
 if(group.fingerprint!==fingerprint)throw fail('CLUSTER_CHANGED','候选组新增或减少了信号，请刷新',409);
 if(action==='dismiss'&&!DISMISS_CLASSES.includes(classification))
  throw fail('BAD_REVIEW_CLASS','请选择具体误报/噪音类别');
 if(['dismiss','confirm'].includes(action)&&(String(reason).trim().length<10||String(reason).trim().length>500))
  throw fail('REVIEW_REASON_REQUIRED','忽略候选组需要 10–500 字的核查理由');
 const existing=store.get('discovery_reviews',id);
 if(expected_revision!==undefined&&expected_revision!==(existing?.revision||0))
  throw fail('REVISION_CONFLICT','候选组已被其他操作修改',409);
 return store.transaction(()=>{
  const fresh=store.get('discovery_reviews',id);
  if(expected_revision!==undefined&&expected_revision!==(fresh?.revision||0))
   throw fail('REVISION_CONFLICT','候选组已被其他操作修改',409);
  const row=store.put('discovery_reviews',{id,status:action==='dismiss'?'dismissed':action==='confirm'?'reviewed_related':'active',
   fingerprint,classification:action==='dismiss'?classification:action==='confirm'?'same_problem_unverified':null,
   reason:action==='restore'?null:String(reason).trim(),
   reviewedBy:'owner',reviewedAt:new Date().toISOString()},fresh?.revision||0);
  store.event('discovery.cluster.reviewed',id,'owner',{action,fingerprint,count:group.signalCount,classification:row.classification});
  return row;
 });
}
