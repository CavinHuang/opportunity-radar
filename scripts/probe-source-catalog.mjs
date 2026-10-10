// Real network probe uses an isolated ephemeral database: no user data or fabricated market facts.
import {openDatabase} from '../src/db.mjs';
import {CATALOG,installCatalogFeed} from '../src/source-catalog.mjs';
import {scanSources} from '../src/source-hub.mjs';

const ids=(process.env.PROBE_CATALOG_IDS||'v2ex-qna,ask-hn,superuser').split(',').map(s=>s.trim()).filter(Boolean).slice(0,5);
const reports=[];
for(const id of ids){
 const item=CATALOG.find(x=>x.id===id);
 if(!item){reports.push({id,status:'not_in_catalog'});continue;}
 const db=openDatabase();
 try{
   const feed=installCatalogFeed(db,id).item;
   const start=Date.now();
   const result=await scanSources(db,{ids:[feed.id]});
   const health=db.get('feeds',feed.id);
   const row={id,title:item.title,url:item.url,status:result.errors.length?'failed':'reachable',received:result.received,imported:result.added,elapsedMs:Date.now()-start,
     error:health.lastError||null,at:new Date().toISOString(),evidence:'RSS availability only; not validated consumer demand'};
   reports.push(row);console.log(JSON.stringify(row));
 }catch(e){const row={id,status:'failed',error:e.message,at:new Date().toISOString()};reports.push(row);console.log(JSON.stringify(row));}
 finally{db.close();}
}
const lines=['### Public RSS reachability probe','',
 '| Source | Result | Items | Reason |','|---|---|---:|---|',
 ...reports.map(x=>`| ${x.id} | ${x.status} | ${x.received??0} | ${String(x.error||'').replaceAll('|','/').slice(0,125)} |`),'',
 '> External failures are not failures of our parser. A successful response does not prove consumer demand.'];
if(process.env.GITHUB_STEP_SUMMARY){const {appendFileSync}=await import('node:fs');appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');}
