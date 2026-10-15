import test from 'node:test';
import assert from 'node:assert/strict';
import {plainSourceText,groundedOpportunityBrief,selectBriefCandidates,candidateOriginals,opportunityFreshness} from '../src/opportunity-brief.mjs';
import {parseFeed} from '../src/signals.mjs';
import {openDatabase} from '../src/db.mjs';
import {scanHomeOpportunities,homeOpportunitySnapshot} from '../src/home-opportunities.mjs';

const text='I manage invoices for my clients. Every week I manually copy invoices into a spreadsheet. This takes 3 hours each week. The spreadsheet cannot match duplicate invoice numbers.';
const originals=[{sourceId:'s1',url:'https://forum.example/1',title:'Invoice workflow',text,publishedAt:null}];
const raw={kind:'product_hypothesis',evidence:Object.fromEntries(Object.entries({
 user:'I manage invoices for my clients',task:'copy invoices into a spreadsheet',pain:'cannot match duplicate invoice numbers',
 workaround:'manually copy invoices into a spreadsheet',existingGap:'The spreadsheet cannot match duplicate invoice numbers',
 recurrence:'Every week',impact:'3 hours each week'
}).map(([key,quote])=>[key,{sourceId:'s1',quote}])),hypothesis:'为每周录入发票的财务提供重复号码核对工具（假设）',
 validation:'先手动为两位财务核对一周发票，记录节省时间；没有减少核对时间就停止。',counterargument:'现有表格公式可能已经足够，先检查现有办法。'};

test('only complete original-bound workflow evidence produces a product hypothesis',()=>{
 const b=groundedOpportunityBrief(raw,originals);
 assert.equal(b.kind,'product_hypothesis');assert.deepEqual(b.gaps,[]);
 assert.equal(b.evidence.impact.url,originals[0].url);
 assert.equal(b.state,'testable_hypothesis_not_validated');
 const missing=structuredClone(raw);delete missing.evidence.existingGap;
 assert.equal(groundedOpportunityBrief(missing,originals).kind,'research_lead');
});
test('hallucinated costs, foreign source quotes and legacy keep judgments never become product hypotheses',()=>{
 for(const evidence of [{sourceId:'s1',quote:'Users will pay $100 every month'},{sourceId:'other',quote:'3 hours each week'}]){
  const b=groundedOpportunityBrief({...raw,evidence:{...raw.evidence,impact:evidence}},originals);
  assert.notEqual(b.kind,'product_hypothesis');assert.deepEqual(b.invalidEvidence,['impact']);
 }
 assert.equal(groundedOpportunityBrief(null,originals).kind,'research_lead');
 const support=groundedOpportunityBrief({kind:'product_hypothesis'},[{sourceId:'x',title:'Browser address cannot edit',text:'I cannot edit the address. I have to click again.'}]);
 assert.equal(support.kind,'support_issue');assert.equal(support.hypothesis,null);
});
test('concise Chinese evidence and exact short frequency expressions are accepted without fabricated padding',()=>{
 const original={sourceId:'cn',url:'https://forum.example/cn',title:'每天处理报销',text:'我是财务，每天手动录入票据。表格无法识别重复，现有办法需要人工逐张核对。'};
 const quotes={user:'我是财务',task:'手动录入票据',pain:'表格无法识别重复',workaround:'人工逐张核对',existingGap:'现有办法需要人工逐张核对',recurrence:'每天'};
 const b=groundedOpportunityBrief({...raw,evidence:Object.fromEntries(Object.entries(quotes).map(([key,quote])=>[key,{sourceId:'cn',quote}]))},[original]);
 assert.equal(b.kind,'product_hypothesis');assert.equal(b.evidence.recurrence.quote,'每天');
 const invalid=groundedOpportunityBrief({...raw,evidence:{...raw.evidence,user:{sourceId:'s1',quote:'I'}}},originals);
 assert.notEqual(invalid.kind,'product_hypothesis');
});
test('old quoted evidence remains a historical research lead even with a newly collected unrelated source',()=>{
 const old={...originals[0],publishedAt:'2015-06-12T14:18:59.000Z'};
 const recent={sourceId:'new',url:'https://forum.example/new',title:'Unrelated newer source',text:'Different subject',publishedAt:new Date().toISOString()};
 const brief=groundedOpportunityBrief(raw,[old,recent]);
 assert.equal(brief.kind,'research_lead');assert.equal(brief.hypothesis,null);
 assert.equal(brief.freshness.status,'historical_only');assert.ok(brief.gaps.includes('current_relevance'));
 assert.equal(groundedOpportunityBrief(raw,[{...old,publishedAt:new Date().toISOString()}]).kind,'product_hypothesis');
});
test('collection timestamps cannot establish source freshness; future and invalid feed dates remain unknown',()=>{
 const nowMs=Date.parse('2026-10-14T00:00:00Z');
 assert.equal(opportunityFreshness([{createdAt:'2026-10-14T00:00:00Z'}],{nowMs}).status,'undated');
 assert.equal(opportunityFreshness([{publishedAt:'not a date'},{publishedAt:'2030-01-01'}],{nowMs}).status,'undated');
 assert.equal(opportunityFreshness([{publishedAt:'2026-10-08T20:02:18Z'}],{nowMs}).status,'recent_feed_date_unverified');
});
test('encoded feed HTML is cleaned before extraction and preserves context beyond 500 characters',()=>{
 const xml='<rss><item><title>Invoice workflow</title><link>https://forum.example/1</link><description>&lt;p&gt;'+ 'Context '.repeat(100)+'I can&#x27;t reconcile invoices every week.&lt;/p&gt;</description></item></rss>';
 const [s]=parseFeed(xml,'https://forum.example/rss');
 assert.ok(s.description.length>500);assert.match(s.description,/I can't reconcile invoices/);assert.doesNotMatch(s.description,/<p>|&#/);
 assert.equal(plainSourceText('<script>invent a cost</script><p>Actual &amp; quoted &#x27;text&#39;</p>'),"Actual & quoted 'text'");
});
test('bounded candidate budget prioritizes recurring costs and reduces single-host support dominance',()=>{
 const db=openDatabase();try{
  const items=[];
  for(let i=0;i<14;i++){const id='s'+i;db.put('sources',{id,title:'I cannot edit browser address',description:'I cannot edit the address, have to click again.',url:'https://support.example/'+i});items.push({id,signalIds:[id],sourceUrls:['https://support.example/'+i]});}
  db.put('sources',{id:'workflow',title:'Invoice workflow',description:text,url:'https://community.example/workflow'});
  items.push({id:'workflow',signalIds:['workflow'],sourceUrls:['https://community.example/workflow']});
  assert.equal(selectBriefCandidates(items,db)[0].id,'workflow');
  assert.equal(selectBriefCandidates(items,db).length,12);
 }finally{db.close();}
});
test('scan sends original context to model and persists grounded briefs, then hides changed evidence while retaining its audit snapshot',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',title:'I cannot reconcile invoice copies',description:text,url:originals[0].url,status:'new'});
  const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'synthetic',RADAR_LLM_MODEL:'test'};
  const out=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>{
   const sent=JSON.parse(JSON.parse(options.body).messages[1].content).candidates[0];
   assert.equal(sent.originals[0].text,text);assert.equal(sent.originals[0].publishedAt,null);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:sent.id,verdict:'keep',reason:'每周手动核对发票耗时',brief:raw}])}}]})};
  }});
  assert.equal(out.productHypotheses,1);assert.equal(out.items[0].opportunityBrief.kind,'product_hypothesis');
  assert.equal(db.list('opportunities').length,0);
  const s=db.get('sources','s1');db.put('sources',{...s,description:'I manually copy invoices each week but cannot match numbers.'},s.revision);
  assert.equal(homeOpportunitySnapshot(db).items.length,0);
  assert.equal(db.get('home_opportunity_scans','latest').items[0].opportunityBrief.kind,'product_hypothesis');
 }finally{db.close();}
});
test('homepage discovery reaches a workflow behind more than 400 newer noisy records',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'s1',title:'I cannot reconcile invoice copies',description:text,url:originals[0].url,status:'new'});
  for(let i=0;i<405;i++)db.put('sources',{id:'noise'+i,title:'New product announcement '+i,description:'We launched our product today.',url:'https://news.example/'+i,status:'new'});
  const env={RADAR_LLM_BASE_URL:'https://models.example/v1',RADAR_LLM_API_KEY:'synthetic',RADAR_LLM_MODEL:'test'};
  const out=await scanHomeOpportunities(db,{env,fetchImpl:async(url,options)=>{
   const sent=JSON.parse(JSON.parse(options.body).messages[1].content).candidates;
   assert.equal(sent.length,1);assert.equal(sent[0].id,'signal:s1');
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:sent[0].id,verdict:'keep',brief:raw}])}}]})};
  }});
  assert.equal(out.scanned,406);assert.equal(out.items[0].opportunityBrief.kind,'product_hypothesis');
 }finally{db.close();}
});
