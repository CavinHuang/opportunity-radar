import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {externalResearchQueries,investigateExternalEvidence,externalResearchBrief} from '../src/opportunity-external-research.mjs';

test('queries use bounded, task-grounded search terms',()=>{
 const q=externalResearchQueries('I cannot reconcile invoice records manually');
 assert.equal(q.length,2);
 assert.ok(q[0].includes('reconcile'));
 assert.ok(q[1].includes('alternative'));
 assert.throws(()=>externalResearchQueries(''),{code:'NO_QUERY'});
});
test('external findings preserve provenance, dedupe HTTPS links and invalidate stale evidence',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'manual-1',status:'new',url:'https://example.org/problem-1',
   title:'I cannot reconcile invoice records manually',
   description:'I manually reconcile invoices every day and spend hours fixing errors'});
  let calls=0;
  const fetchImpl=async(url,options)=>{
   calls++;
   assert.equal(url.origin,'https://hn.algolia.com');
   assert.equal(url.searchParams.get('tags'),'(story,comment)');
   assert.equal(options.redirect,'error');
   return {ok:true,json:async()=>({hits:[
    {objectID:'123',title:'Invoice reconciliation alternatives',url:'https://news.ycombinator.com/item?id=123',author:'example',created_at:'2025-05-02'},
    {objectID:'123',title:'Duplicate',url:'https://news.ycombinator.com/item?id=123'},
    {objectID:'124',title:'Unsafe',url:'javascript:alert(1)'}
   ]})};
  };
  const list=await import('../src/opportunity-scan.mjs');
  const candidate=list.opportunityScanCandidates(db).items[0];
  assert.ok(candidate?.id);
  const saved=await investigateExternalEvidence(db,candidate.id,{fetchImpl});
  assert.equal(calls,3);
  assert.equal(saved.sourceStatus.find(x=>x.source==='GitHub Issues').status,'failed');
  assert.ok(saved.results.length>=1);
  assert.ok(saved.results.every(x=>x.url.startsWith('https://')));
  assert.equal(saved.status,'needs_owner_review');
  assert.equal(externalResearchBrief(db,candidate.id).stale,false);
  const s=db.get('sources','manual-1');
  db.put('sources',{...s,description:s.description+' and more details'},s.revision);
  assert.equal(externalResearchBrief(db,candidate.id).stale,true);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
test('network errors do not record fake research results',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'manual-1',status:'new',url:'https://example.org/problem-1',
   title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
  const {opportunityScanCandidates}=await import('../src/opportunity-scan.mjs');
  const id=opportunityScanCandidates(db).items[0].id;
  await assert.rejects(()=>investigateExternalEvidence(db,id,{fetchImpl:async()=>({ok:false,status:429})}),{code:'EXTERNAL_SEARCH_FAILED'});
  assert.equal(db.list('opportunity_external_research').length,0);
 }finally{db.close();}
});

test('GitHub Issues search includes only canonical issues and records per-source success',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'manual-2',status:'new',url:'https://example.org/problem-2',
   title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
  const {opportunityScanCandidates}=await import('../src/opportunity-scan.mjs');
  const id=opportunityScanCandidates(db).items[0].id;
  const fetchImpl=async(url)=>url.hostname==='api.github.com'
   ?{ok:true,json:async()=>({items:[
    {html_url:'https://github.com/example/app/issues/12',title:'Invoice import broken',body:'Issue report',user:{login:'reporter'},created_at:'2026-10-10'},
    {html_url:'https://github.com/example/app/pull/13',title:'Pull request'},
    {html_url:'https://evil.example/issues/14',title:'Untrusted'}
   ]})}:{ok:true,json:async()=>({hits:[]})};
  const saved=await investigateExternalEvidence(db,id,{fetchImpl});
  assert.equal(saved.results.length,1);
  assert.equal(saved.results[0].source,'GitHub Issues');
  assert.equal(saved.sourceStatus.find(x=>x.source==='GitHub Issues').status,'ok');
  assert.equal(saved.sourceStatus.find(x=>x.source==='Hacker News').count,0);
 }finally{db.close();}
});

test('queries preserve short task acronyms and remove generic question phrasing',()=>{
 const q=externalResearchQueries('How to have control over the automatic mounting of USB drives on Windows?');
 assert.match(q[0],/usb/);assert.match(q[0],/windows/);assert.match(q[0],/mounting/);
 assert.doesNotMatch(q[0],/control|over|have/);
 assert.match(externalResearchQueries('I cannot import CSV into Excel')[0],/csv/);
 assert.match(externalResearchQueries('PDF invoice export problem')[0],/pdf/);
});

test('HN query failure preserves a successful query and GitHub results with explicit partial status',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'partial',status:'new',url:'https://example.org/partial',title:'I cannot import CSV files into Excel',description:'I manually import CSV files every day and spend hours fixing errors'});
  let hnCalls=0;
  const saved=await investigateExternalEvidence(db,'signal:partial',{fetchImpl:async url=>{
   if(url.hostname==='hn.algolia.com')return ++hnCalls===1?{ok:false,status:429}:{ok:true,json:async()=>({hits:[{objectID:'123',title:'CSV Excel import workaround',url:'https://news.ycombinator.com/item?id=123'}]})};
   return {ok:true,json:async()=>({items:[{html_url:'https://github.com/example/app/issues/1',title:'CSV Excel import broken'}]})};
  }});
  assert.equal(saved.results.length,2);
  const hn=saved.sourceStatus.find(x=>x.source==='Hacker News');
  assert.equal(hn.status,'partial');assert.equal(hn.queries[0].status,'failed');assert.equal(hn.queries[1].status,'ok');
  assert.equal(saved.sourceStatus.find(x=>x.source==='GitHub Issues').status,'ok');
  assert.ok(saved.analysis.missing.some(x=>x.includes('Hacker News')));
 }finally{db.close();}
});

test('both HN queries failing does not prevent successful GitHub-only research',async()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'github-only',status:'new',url:'https://example.org/gh',title:'I cannot import CSV files into Excel',description:'I manually import CSV files every day and spend hours fixing errors'});
  const saved=await investigateExternalEvidence(db,'signal:github-only',{fetchImpl:async url=>url.hostname==='hn.algolia.com'
   ?{ok:false,status:503}:{ok:true,json:async()=>({items:[]})}});
  assert.equal(saved.sourceStatus[0].status,'failed');assert.equal(saved.results.length,0);
  assert.equal(saved.sourceStatus[1].status,'ok');assert.equal(saved.status,'needs_owner_review');
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
