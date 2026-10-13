import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {firsthandHint,verificationContext,verifyProblem} from '../src/problem-verification.mjs';
import {interviewBoard} from '../src/problem-interviews.mjs';
const source={id:'a',status:'new',url:'https://forum.example/a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day, spending hours fixing errors'};
test('first-person hint is not treated as author verification',()=>{assert.equal(firsthandHint(source).level,'possible_firsthand');assert.equal(firsthandHint({...source,description:'According to a report users say this fails'}).level,'possible_secondhand')});
test('owner evidence review requires specific corroboration for interview priority',()=>{
 const db=openDatabase();try{
 db.put('sources',source);
 const context=verificationContext(db,'signal:a');const base={fingerprint:context.fingerprint,firsthandConfirmed:false,impactConfirmed:false,actualWorkaround:'',alternativeAdequacy:'unknown',notes:'Reviewed original public post carefully',expected_revision:0};
 assert.throws(()=>verifyProblem(db,'signal:a',{...base,decision:'worth_interviewing'}),{code:'INSUFFICIENT_VERIFICATION'});
 const row=verifyProblem(db,'signal:a',{...base,decision:'needs_more_evidence'});
 assert.equal(row.decision,'needs_more_evidence');
 assert.equal(db.list('opportunities').length,0);
 const changed=db.get('sources','a');db.put('sources',{...changed,description:'changed from original evidence'},changed.revision);
 assert.throws(()=>verifyProblem(db,'signal:a',{...base,expected_revision:row.revision}),e=>e.code==='STALE_EVIDENCE'||e.code==='CANDIDATE_NOT_FOUND');
 }finally{db.close()}
});
test('triage-style revision (non-content) does not invalidate a verified fingerprint',()=>{
 const db=openDatabase();try{
  db.put('sources',source);
  const before=verificationContext(db,'signal:a').fingerprint;
  const changed=db.get('sources','a');db.put('sources',{...changed,feedIds:['feed-2']},changed.revision);
  assert.equal(verificationContext(db,'signal:a').fingerprint,before);
 }finally{db.close()}
});
test('verified problem stays accessible after leaving the candidate window',()=>{
 const db=openDatabase();try{
  db.put('sources',source);
  const context=verificationContext(db,'signal:a');
  const row=verifyProblem(db,'signal:a',{fingerprint:context.fingerprint,firsthandConfirmed:true,impactConfirmed:true,actualWorkaround:'manual copy every day',alternativeAdequacy:'inadequate',decision:'worth_interviewing',notes:'Reviewed the original public post carefully',expected_revision:0});
  assert.ok(row.signalIds.includes('a'));assert.equal(row.title,source.title);
  // 把该信号挤出 top-400 候选窗口：核查/访谈入口必须仍可解析，存量记录不得变孤儿。
  for(let i=0;i<405;i++)db.put('sources',{id:'bulk-'+i,status:'new',url:'https://forum.example/bulk-'+i,title:'Bulk filler post number '+i,description:'filler signal to push the candidate window'});
  const after=verificationContext(db,'signal:a');
  assert.equal(after.candidate.id,'signal:a');
  assert.equal(after.candidate.title,source.title);
  assert.equal(after.fingerprint,context.fingerprint);
  const board=interviewBoard(db,'signal:a');
  assert.equal(board.candidate.title,source.title);
  assert.equal(board.plans.length,0);
 }finally{db.close()}
});
