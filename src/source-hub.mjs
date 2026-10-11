import { randomUUID, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { configuredFeeds, parseFeed } from './signals.mjs';
import { pinnedHttpsFetch } from './pinned-https.mjs';

const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const time=()=>new Date().toISOString();
export const DEFAULT_SCAN_MINUTES=360;
const MAX_BACKOFF_MINUTES=1440;
const scansInProgress=new WeakSet();
function intervalMinutes(value){
  const n=Number(value??DEFAULT_SCAN_MINUTES);
  if(!Number.isInteger(n)||n<15||n>1440)throw error('BAD_SCAN_INTERVAL','采集间隔必须是 15–1440 分钟');
  return n;
}
const nextScan=(nowMs,minutes)=>new Date(nowMs+minutes*60_000).toISOString();
export function sourceHealth(store,nowMs=Date.now()){
  const feeds=store.list('feeds');
  return {total:feeds.length,enabled:feeds.filter(f=>f.enabled).length,due:feeds.filter(f=>f.enabled&&(!f.nextScanAt||!Number.isFinite(Date.parse(f.nextScanAt))||Date.parse(f.nextScanAt)<=nowMs)).length,
    failing:feeds.filter(f=>f.enabled&&(f.consecutiveFailures||0)>0).length,
    lastSuccessfulScan:feeds.map(f=>f.lastSuccessAt).filter(Boolean).sort().at(-1)||null,
    nextScheduledScan:feeds.filter(f=>f.enabled).map(f=>f.nextScanAt).filter(Boolean).sort()[0]||null};
}

const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const blockedV4=(parts)=>{
  const [a,b]=parts;
  return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0||a===198&&[18,19].includes(b)||a===198&&b===51||a===203&&b===0;
};
export function isPrivateAddress(address){
  const ip=isIP(address);
  if(ip===4)return blockedV4(address.split('.').map(Number));
  if(ip===6){const x=address.toLowerCase();if(x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe8')||x.startsWith('fe9')||x.startsWith('fea')||x.startsWith('feb')||x.startsWith('ff'))return true;
    if(x.startsWith('::ffff:'))return isPrivateAddress(x.slice(7));return x.startsWith('2001:db8:');
  }
  return true;
}
export function validateFeedUrl(input){
  let url;try{url=new URL(String(input))}catch{throw error('BAD_FEED_URL','请输入有效的 HTTPS RSS/Atom 地址');}
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw error('BAD_FEED_URL','仅允许标准 HTTPS RSS/Atom 地址，无凭证或自定义端口');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||isIP(host)&&isPrivateAddress(host))throw error('BAD_FEED_URL','禁止访问内部网络或本机地址');
  url.hash='';return url.href;
}
export function canonicalArticleUrl(input){
  const url=new URL(input);url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(key))url.searchParams.delete(key);
  url.hostname=url.hostname.toLowerCase();return url.href;
}
export function seedConfiguredSources(store,env=process.env.RADAR_FEED_URLS||''){
  // Older installations stored passive feed items as signal_only. Preserve them.
  for(const item of store.list('sources').filter(x=>x.status==='signal_only'))store.put('sources',{...item,status:'new',feedIds:[],linkedOpportunityId:null},item.revision);
  for(const raw of configuredFeeds(env)){
    let url;try{url=validateFeedUrl(raw)}catch{continue;}
    if(!store.list('feeds').some(x=>x.url===url))store.put('feeds',{id:randomUUID(),url,title:new URL(url).hostname,market:'',keywords:[],enabled:true,createdAt:time(),lastCheckedAt:null,lastSuccessAt:null,lastError:null,itemsSeen:0,addedTotal:0,origin:'env',intervalMinutes:DEFAULT_SCAN_MINUTES,nextScanAt:null,consecutiveFailures:0,etag:null,lastModified:null});
  }
}
export function addFeed(store,data){
  const url=validateFeedUrl(data.url);
  if(store.list('feeds').some(f=>f.url===url))throw error('FEED_EXISTS','此 RSS 来源已存在',409);
  if(store.list('feeds').length>=30)throw error('SOURCE_LIMIT','最多管理 30 个来源');
  const keywords=parseKeywords(data.keywords);
  const item=store.put('feeds',{id:randomUUID(),url,title:clean(data.title,100)||new URL(url).hostname,market:clean(data.market,100),keywords,enabled:true,origin:'user',lastCheckedAt:null,lastSuccessAt:null,lastError:null,itemsSeen:0,addedTotal:0,createdAt:time(),intervalMinutes:intervalMinutes(data.intervalMinutes),nextScanAt:null,consecutiveFailures:0,etag:null,lastModified:null});
  store.event('source.created',item.id,'owner',{title:item.title});return item;
}
export function parseKeywords(raw){
  if(raw===undefined||raw===null||raw==='')return [];
  const parts=Array.isArray(raw)?raw:String(raw).split(/[,，\n]/);
  if(parts.length>12)throw error('BAD_KEYWORDS','每个来源最多 12 个关键词');
  return [...new Set(parts.map(x=>clean(x,60)).filter(Boolean))];
}
export function editFeed(store,id,data){
  const item=store.get('feeds',id);if(!item)throw error('NOT_FOUND','信息源不存在',404);
  if(data.expected_revision!==item.revision)throw error('REVISION_CONFLICT','来源已发生变更，请刷新后重试',409);
  const keywords=data.keywords===undefined?item.keywords:parseKeywords(data.keywords);
  const filtersChanged=JSON.stringify(keywords)!==JSON.stringify(item.keywords);
  const next=store.put('feeds',{...item,title:data.title===undefined?item.title:clean(data.title,100)||item.title,
    market:data.market===undefined?item.market:clean(data.market,100),enabled:data.enabled===undefined?item.enabled:data.enabled===true,
    keywords,intervalMinutes:data.intervalMinutes===undefined?(item.intervalMinutes||DEFAULT_SCAN_MINUTES):intervalMinutes(data.intervalMinutes),
    nextScanAt:(data.enabled===true&&!item.enabled)||filtersChanged?null:item.nextScanAt,
    etag:filtersChanged?null:item.etag,lastModified:filtersChanged?null:item.lastModified},item.revision);
  store.event('source.updated',id,'owner',{enabled:next.enabled});return next;
}
function scanResultStore(store,feed,updates,nowMs){
  const fresh=store.get('feeds',feed.id);
  return store.put('feeds',{...fresh,...updates,lastCheckedAt:new Date(nowMs).toISOString()},fresh.revision);
}
const checkPublicHost=async(url,dnsLookup)=>{
  const host=new URL(url).hostname;
  if(isIP(host)){
    if(isPrivateAddress(host))throw error('SOURCE_PRIVATE_NETWORK','不允许访问内部网络',400);
    return [{address:host,family:isIP(host)}];
  }
  const records=await dnsLookup(host,{all:true});
  if(!records?.length||records.some(r=>!isIP(r.address)||isPrivateAddress(r.address)||
    r.family&&r.family!==isIP(r.address)))
    throw error('SOURCE_PRIVATE_NETWORK','来源解析到了不允许访问的地址',400);
  return records;
};
async function fetchFeed(url,{fetchImpl,dnsLookup,maxBytes=1024*1024,etag,lastModified}){
  const origin=new URL(validateFeedUrl(url)).origin;
  let current=validateFeedUrl(url);
  for(let i=0;i<=2;i++){
    const addresses=await checkPublicHost(current,dnsLookup);
    const sameOrigin=new URL(current).origin===origin;
    const sentEtag=sameOrigin?etag:null,sentLastModified=sameOrigin?lastModified:null;
    const response=await fetchImpl(current,{addresses,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'NorthstarRadar/1.9 (+personal RSS reader)','Accept':'application/rss+xml,application/atom+xml,application/xml,text/xml',...(sentEtag?{'If-None-Match':sentEtag}:{}),...(sentLastModified?{'If-Modified-Since':sentLastModified}:{})}});
    if([301,302,303,307,308].includes(response.status)){
      if(i>=2)throw error('SOURCE_REDIRECT','来源重定向次数超限');
      const location=response.headers.get('location');if(!location)throw error('SOURCE_REDIRECT','来源的重定向缺少目标地址');
      current=validateFeedUrl(new URL(location,current).href);await response.body?.cancel();continue;
    }
    if(response.status===304){
      await response.body?.cancel();
      if(!sentEtag&&!sentLastModified)throw error('SOURCE_HTTP','来源未提供条件请求却返回了 304');
      return {notModified:true,etag:sentEtag,lastModified:sentLastModified};
    }
    if(!response.ok){
      const failure=error('SOURCE_HTTP',`HTTP ${response.status}`);
      if([429,503].includes(response.status)){
        const raw=response.headers.get('retry-after');
        const seconds=Number(raw),date=Date.parse(raw);
        if(raw)failure.retryAfterMs=Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?Math.max(0,date-Date.now()):0;
      }
      throw failure;
    }
    if(Number(response.headers.get('content-length')||0)>maxBytes)throw error('SOURCE_TOO_LARGE','RSS 超过 1MB 限制');
    const chunks=[];let length=0;const reader=response.body?.getReader();
    if(!reader)throw error('SOURCE_EMPTY','无可读取的 RSS 内容');
    try{
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes)throw error('SOURCE_TOO_LARGE','RSS 超过 1MB 限制');chunks.push(value);}
    }finally{await reader.cancel().catch(()=>{});}
    const xml=new TextDecoder().decode(Buffer.concat(chunks));
    if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw error('SOURCE_NOT_RSS','来源不是有效的 RSS 或 Atom 文档');
    return {xml,notModified:false,etag:sameOrigin?response.headers.get('etag')||null:null,lastModified:sameOrigin?response.headers.get('last-modified')||null:null};
  }
  throw error('SOURCE_REDIRECT','无法获取 RSS');
}
export async function scanSources(store,{ids,fetchImpl=pinnedHttpsFetch,dnsLookup=lookup,onlyDue=false,nowMs=Date.now()}={}){
  if(scansInProgress.has(store))throw error('SCAN_IN_PROGRESS','采集任务正在运行，请稍后重试',409);
  const requested=ids?.length?ids:null;
  if(requested&&new Set(requested).size!==requested.length)throw error('BAD_REQUEST','来源 ID 重复');
  let feeds=store.list('feeds').filter(f=>requested?requested.includes(f.id):f.enabled);
  if(requested&&feeds.length!==requested.length)throw error('NOT_FOUND','指定的信息源不存在',404);
  if(onlyDue)feeds=feeds.filter(f=>f.enabled&&(!f.nextScanAt||!Number.isFinite(Date.parse(f.nextScanAt))||Date.parse(f.nextScanAt)<=nowMs));
  if(feeds.length>30)throw error('SOURCE_LIMIT','最多扫描 30 个信息源');
  const result={feeds:feeds.length,received:0,added:0,filtered:0,duplicates:0,notModified:0,skipped:0,errors:[],details:[]};
  scansInProgress.add(store);
  try{
    for(const feed of feeds){
      let received=0,added=0,filtered=0,duplicates=0,notModified=false;
      const normal=intervalMinutes(feed.intervalMinutes);
      try{
        const response=await fetchFeed(feed.url,{fetchImpl,dnsLookup,etag:feed.etag,lastModified:feed.lastModified});
        notModified=response.notModified;
        // Commit each feed's new signals and its scan watermark atomically:
        // invalid late items must never leave an apparently successful partial import.
        const items=notModified?[]:parseFeed(response.xml,feed.url);
        store.transaction(()=>{
          const current=store.get('feeds',feed.id);
          if(!current||current.revision!==feed.revision)
            throw error('SOURCE_CHANGED','信息源在采集过程中被修改或删除',409);
          received=items.length;
          for(const candidate of items){
            const text=(candidate.title+' '+candidate.description).toLocaleLowerCase();
            if(feed.keywords.length&&!feed.keywords.some(k=>text.includes(k.toLocaleLowerCase()))){filtered++;continue;}
            const canonical=canonicalArticleUrl(candidate.url),id=hash(canonical);
            const existing=store.get('sources',id);
            if(existing){
              duplicates++;
              if(!existing.feedIds?.includes(feed.id))store.put('sources',{...existing,feedIds:[...(existing.feedIds||[]),feed.id]},existing.revision);
              continue;
            }
            store.put('sources',{...candidate,id,url:canonical,feed:feed.url,feedIds:[feed.id],market:feed.market,sourceClass:feed.sourceClass||'unknown',publishedAt:candidate.publishedAt||null,createdAt:time(),status:'new',linkedOpportunityId:null});added++;
          }
          scanResultStore(store,feed,{lastSuccessAt:new Date(nowMs).toISOString(),lastError:null,consecutiveFailures:0,
            nextScanAt:nextScan(nowMs,normal),etag:response.etag,lastModified:response.lastModified,
            itemsSeen:(feed.itemsSeen||0)+received,addedTotal:(feed.addedTotal||0)+added},nowMs);
          store.event('source.scan_succeeded',feed.id,'system',{received,added,filtered,duplicates,notModified,checkedAt:new Date(nowMs).toISOString()});
        });
      }catch(e){
        // A concurrent edit/delete invalidates the in-flight snapshot. Never
        // import signals, overwrite revised scheduling, or mark it as failure.
        const current=store.get('feeds',feed.id);
        if(!current||current.revision!==feed.revision){
          result.skipped++;
          store.event('source.scan_skipped',feed.id,'system',{reason:current?'source_changed':'source_deleted',checkedAt:new Date(nowMs).toISOString()});
          result.details.push({feedId:feed.id,title:feed.title,received:0,added:0,filtered:0,duplicates:0,notModified:false,skipped:true,error:null});
          continue;
        }
        // A failed feed transaction has rolled back all candidate writes.
        // Never report rolled-back rows as successfully imported signals.
        received=0;added=0;filtered=0;duplicates=0;notModified=false;
        const failures=(feed.consecutiveFailures||0)+1;
        const backoff=Math.min(MAX_BACKOFF_MINUTES,normal*Math.pow(2,Math.min(failures-1,8)));
        const retryMs=Number.isFinite(e.retryAfterMs)?Math.min(24*60*60_000,e.retryAfterMs):0;
        const errMsg=clean(e.message,300);
        store.transaction(()=>{
          const latest=store.get('feeds',feed.id);
          if(!latest||latest.revision!==feed.revision)throw error('SOURCE_CHANGED','来源设置在失败处理时已改变',409);
          const backoffUntil=new Date(nowMs+Math.max(backoff*60_000,retryMs)).toISOString();
          scanResultStore(store,feed,{lastError:errMsg,consecutiveFailures:failures,nextScanAt:backoffUntil},nowMs);
          store.event('source.scan_failed',feed.id,'system',{code:clean(e.code||'SOURCE_ERROR',80),consecutiveFailures:failures,nextScanAt:backoffUntil,checkedAt:new Date(nowMs).toISOString()});
        });
        result.errors.push({feedId:feed.id,feed:feed.url,error:errMsg});
      }
      result.received+=received;result.added+=added;result.filtered+=filtered;result.duplicates+=duplicates;
      if(notModified)result.notModified++;
      result.details.push({feedId:feed.id,title:feed.title,received,added,filtered,duplicates,notModified,error:result.errors.find(x=>x.feedId===feed.id)?.error||null});
    }
    return result;
  }finally{scansInProgress.delete(store);}
}
export function addManualSignal(store,data){
  let url;try{url=new URL(String(data.url||''));}catch{throw error('BAD_SIGNAL_URL','需要可追溯的原始网页 URL');}
  if(url.protocol!=='https:'||url.username||url.password)throw error('BAD_SIGNAL_URL','机会证据必须使用公开 HTTPS 网页 URL');
  const title=clean(data.title,220),description=clean(data.description,500);
  if(!title||!description)throw error('BAD_REQUEST','标题和真实摘要不能为空');
  const canonical=canonicalArticleUrl(url.href),id=hash(canonical);
  if(store.get('sources',id))throw error('SIGNAL_EXISTS','同一网页信号已经收录',409);
  const item=store.put('sources',{id,title,description,url:canonical,feed:'manual',feedIds:[],market:clean(data.market,100),publishedAt:null,createdAt:time(),status:'new',linkedOpportunityId:null,origin:'user_manual_unverified'});
  store.event('signal.manually_added',id,'owner',{url:canonical});return item;
}
export function triageSignal(store,id,{status,expected_revision}){
  const signal=store.get('sources',id);if(!signal)throw error('NOT_FOUND','信号不存在',404);
  if(!['new','saved','dismissed'].includes(status))throw error('BAD_SIGNAL_STATUS','状态只能是 new / saved / dismissed');
  if(signal.status==='converted')throw error('SIGNAL_CONVERTED','此信号已经关联机会',409);
  const item=store.put('sources',{...signal,status,triagedAt:time()},expected_revision);
  store.event('signal.triaged',id,'owner',{status});return item;
}
export function querySignals(store,{status='all',sourceId,keyword='',offset=0,limit=30}={}){
  const statuses=new Set(['all','new','saved','dismissed','converted']);
  if(!statuses.has(status))throw error('BAD_SIGNAL_STATUS','无效信号状态');
  if(!Number.isInteger(Number(offset))||Number(offset)<0||Number(offset)>100000)throw error('BAD_REQUEST','无效分页偏移');
  const n=Math.min(60,Math.max(1,Number(limit)||30));
  const all=store.list('sources');
  const counts=Object.fromEntries(['new','saved','dismissed','converted'].map(k=>[k,all.filter(s=>s.status===k).length]));
  const matched=all.filter(s=>(status==='all'||s.status===status)&&(!sourceId||s.feedIds?.includes(sourceId))&&(!keyword||(`${s.title} ${s.description}`).toLocaleLowerCase().includes(String(keyword).toLocaleLowerCase())));
  return {items:matched.slice(Number(offset),Number(offset)+n),total:matched.length,counts,limit:n,offset:Number(offset)};
}
