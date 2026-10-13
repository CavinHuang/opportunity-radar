import {createHash} from 'node:crypto';
import {candidateContext} from './opportunity-research.mjs';

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const plain=x=>String(x??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,450);
const safeLink=raw=>{try{const u=new URL(raw);return u.protocol==='https:'?u.href:null;}catch{return null;}};
const words=text=>String(text||'').normalize('NFKC').toLowerCase().match(/[a-z]{4,}|[\p{Script=Han}]{2,}/gu)||[];
export function externalResearchQueries(title){
 const tokens=[...new Set(words(title).filter(x=>!['cannot','unable','every','with','from','have','need','problem','workflow'].includes(x)))].slice(0,6);
 if(!tokens.length)throw fail('NO_QUERY','候选标题无法提取搜索词');
 return [tokens.join(' '),tokens.slice(0,4).join(' ')+' alternative'].filter((x,i,a)=>x&&a.indexOf(x)===i);
}
export function externalResearchStatus(store,id){
 const row=store.get('opportunity_external_research',id);
 return {revision:row?.revision||0,record:row||null};
}
export async function investigateExternalEvidence(store,id,{fetchImpl=globalThis.fetch,now=()=>new Date().toISOString()}={}){
 const context=candidateContext(store,id),queries=externalResearchQueries(context.candidate.title);
 const results=[],seen=new Set(),sourceStatus=[];
 for(const query of queries){
  // Fixed public endpoint: never fetch an untrusted URL or follow a post URL.
  const endpoint=new URL('https://hn.algolia.com/api/v1/search');
  endpoint.searchParams.set('query',query);endpoint.searchParams.set('tags','story,comment');endpoint.searchParams.set('hitsPerPage','15');
  const response=await fetchImpl(endpoint,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{Accept:'application/json'}});
  if(!response.ok)throw fail('EXTERNAL_SEARCH_FAILED','社区检索 HTTP '+response.status,502);
  const payload=await response.json();
  if(!Array.isArray(payload?.hits))throw fail('EXTERNAL_SEARCH_INVALID','社区检索响应格式错误',502);
  for(const hit of payload.hits.slice(0,15)){
   const url=safeLink(hit.url)||safeLink(hit.objectID?'https://news.ycombinator.com/item?id='+encodeURIComponent(hit.objectID):'');
   if(!url||seen.has(url))continue;seen.add(url);
   results.push({url,title:plain(hit.title||hit.story_title||hit.comment_text)||'未命名讨论',
    excerpt:plain(hit.comment_text||hit.story_text),author:plain(hit.author).slice(0,80),
    source:'Hacker News',query,createdAt:hit.created_at||null,
    classification:'unreviewed_external_search_hit'});
  }
 }
 // GitHub issue search complements community discussion with concrete bug/friction reports.
 // Public API calls may be rate limited; preserve successful sources and report failures.
 const githubQuery=queries[0].split(' ').slice(0,4).join(' ')+' is:issue';
 const githubUrl=new URL('https://api.github.com/search/issues');
 githubUrl.searchParams.set('q',githubQuery);
 githubUrl.searchParams.set('per_page','15');
 try{
  const response=await fetchImpl(githubUrl,{signal:AbortSignal.timeout(12000),redirect:'error',
   headers:{Accept:'application/vnd.github+json','User-Agent':'OpportunityRadar/1.0','X-GitHub-Api-Version':'2022-11-28'}});
  if(!response.ok)throw fail('GITHUB_SEARCH_FAILED','GitHub Issues 检索 HTTP '+response.status,502);
  const payload=await response.json();
  if(!Array.isArray(payload?.items))throw fail('GITHUB_SEARCH_INVALID','GitHub Issues 检索响应格式错误',502);
  let count=0;
  for(const issue of payload.items.slice(0,15)){
   const url=safeLink(issue.html_url);
   // Search only canonical public GitHub issue pages, never pull requests or arbitrary URLs.
   if(!url||new URL(url).hostname!=='github.com'||!new RegExp('^/[^/]+/[^/]+/issues/[0-9]+
   seen.add(url);count++;
   results.push({url,title:plain(issue.title)||'未命名 Issue',excerpt:plain(issue.body),
    author:plain(issue.user?.login).slice(0,80),source:'GitHub Issues',query:githubQuery,
    createdAt:issue.created_at||null,classification:'unreviewed_external_search_hit'});
  }
  sourceStatus.push({source:'GitHub Issues',status:'ok',count});
 }catch(e){
  sourceStatus.push({source:'GitHub Issues',status:'failed',reason:String(e.code||'FETCH_FAILED')});
 }
 sourceStatus.unshift({source:'Hacker News',status:'ok',count:results.filter(x=>x.source==='Hacker News').length});
 // These are retrieval leads, not independent users, proven competitors, or verified claims.
 const record={id,candidateFingerprint:context.fingerprint,queryFingerprint:digest(queries),
  queries,sourceStatus,results:results.slice(0,35),searchedAt:now(),status:'needs_owner_review',
  missing:['独立用户与原帖关系未核查','检索结果可能相关性不足','现有产品能力及收费情况未核查','不能根据没有搜索结果断言市场空白'],
  notice:'只查询固定 Hacker News 与 GitHub Issues 公开接口；部分来源失败会显式记录。命中结果不是已验证的竞争产品或独立用户证据。'};
 const previous=externalResearchStatus(store,id);
 return store.transaction(()=>{
  const current=candidateContext(store,id);
  if(current.fingerprint!==context.fingerprint)throw fail('CANDIDATE_CHANGED','候选来源已变化，请重新搜索',409);
  const saved=store.put('opportunity_external_research',record,previous.revision);
  store.event('opportunity.external_research.searched',id,'owner',{hits:saved.results.length,revision:saved.revision});
  return saved;
 });
}
export function externalResearchBrief(store,id){
 const context=candidateContext(store,id),current=externalResearchStatus(store,id);
 return {candidateId:id,current:current.record&&current.record.candidateFingerprint===context.fingerprint,
   stale:!!current.record&&current.record.candidateFingerprint!==context.fingerprint,
   results:current.record?.results||[],queries:current.record?.queries||[],sourceStatus:current.record?.sourceStatus||[],
   searchedAt:current.record?.searchedAt||null,revision:current.revision,
   notice:'匹配结果只能用于进一步调查；不能自动认定为相同问题、独立需求或有效竞品。'};
}
).test(new URL(url).pathname)||issue.pull_request||seen.has(url))continue;
   seen.add(url);count++;
   results.push({url,title:plain(issue.title)||'未命名 Issue',excerpt:plain(issue.body),
    author:plain(issue.user?.login).slice(0,80),source:'GitHub Issues',query:githubQuery,
    createdAt:issue.created_at||null,classification:'unreviewed_external_search_hit'});
  }
  sourceStatus.push({source:'GitHub Issues',status:'ok',count});
 }catch(e){
  sourceStatus.push({source:'GitHub Issues',status:'failed',reason:String(e.code||'FETCH_FAILED')});
 }
 sourceStatus.unshift({source:'Hacker News',status:'ok',count:results.filter(x=>x.source==='Hacker News').length});
 // These are retrieval leads, not independent users, proven competitors, or verified claims.
 const record={id,candidateFingerprint:context.fingerprint,queryFingerprint:digest(queries),
  queries,sourceStatus,results:results.slice(0,35),searchedAt:now(),status:'needs_owner_review',
  missing:['独立用户与原帖关系未核查','检索结果可能相关性不足','现有产品能力及收费情况未核查','不能根据没有搜索结果断言市场空白'],
  notice:'只查询固定 Hacker News 与 GitHub Issues 公开接口；部分来源失败会显式记录。命中结果不是已验证的竞争产品或独立用户证据。'};
 const previous=externalResearchStatus(store,id);
 return store.transaction(()=>{
  const current=candidateContext(store,id);
  if(current.fingerprint!==context.fingerprint)throw fail('CANDIDATE_CHANGED','候选来源已变化，请重新搜索',409);
  const saved=store.put('opportunity_external_research',record,previous.revision);
  store.event('opportunity.external_research.searched',id,'owner',{hits:saved.results.length,revision:saved.revision});
  return saved;
 });
}
export function externalResearchBrief(store,id){
 const context=candidateContext(store,id),current=externalResearchStatus(store,id);
 return {candidateId:id,current:current.record&&current.record.candidateFingerprint===context.fingerprint,
   stale:!!current.record&&current.record.candidateFingerprint!==context.fingerprint,
   results:current.record?.results||[],queries:current.record?.queries||[],sourceStatus:current.record?.sourceStatus||[],
   searchedAt:current.record?.searchedAt||null,revision:current.revision,
   notice:'匹配结果只能用于进一步调查；不能自动认定为相同问题、独立需求或有效竞品。'};
}
