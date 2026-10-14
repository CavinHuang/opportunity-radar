import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {homeDiscoveryCandidates} from '../src/home-discovery-candidates.mjs';
import {verificationContext,verifyProblem} from '../src/problem-verification.mjs';
import {candidateContext} from '../src/opportunity-research.mjs';
import {createInterviewPlan,interviewBoard} from '../src/problem-interviews.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {createHash} from 'node:crypto';

const source={id:'older',title:'I cannot reconcile invoices for my clients',description:'Every week I manually copy invoices. I lose 3 hours each week because the spreadsheet cannot match invoice numbers.',url:'https://forum.example/older',status:'new'};
function setup(){
 const db=openDatabase();db.put('sources',source);
 for(let i=0;i<405;i++)db.put('sources',{id:'noise'+i,title:'Product launch '+i,description:'We launched our new product today.',url:'https://news.example/'+i,status:'new'});
 return db;
}
test('an older homepage candidate supports source review, research and interview follow-up in one population',()=>{
 const db=setup();try{
  assert.equal(opportunityScanCandidates(db,{limit:50}).items.length,0);
  assert.equal(homeDiscoveryCandidates(db).items[0].id,'signal:older');
  const context=verificationContext(db,'signal:older');
  assert.equal(candidateContext(db,'signal:older').sources[0].id,'older');
  verifyProblem(db,'signal:older',{fingerprint:context.fingerprint,firsthandConfirmed:true,impactConfirmed:true,
   actualWorkaround:'Manual spreadsheet reconciliation reviewed',alternativeAdequacy:'inadequate',decision:'worth_interviewing',
   notes:'Synthetic owner review of the described workflow',expected_revision:0});
  const plan=createInterviewPlan(db,'signal:older',{audience:'People who reconcile client invoices',hypothesis:'Repeated reconciliation costs meaningful time',
   falsifier:'Existing spreadsheet formulas solve this adequately',questions:'What happened last week and how did you solve it?',minInterviews:2});
  assert.equal(interviewBoard(db,'signal:older').plans[0].id,plan.id);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close();}
});
test('source edits invalidate an older review and source dismissal removes every follow-up entry',()=>{
 const db=setup();try{
  const old=verificationContext(db,'signal:older');
  const s=db.get('sources','older');db.put('sources',{...s,description:source.description+' More context.'},s.revision);
  assert.throws(()=>verifyProblem(db,'signal:older',{fingerprint:old.fingerprint}),{code:'STALE_EVIDENCE'});
  const updated=db.get('sources','older');db.put('sources',{...updated,status:'dismissed'},updated.revision);
  assert.equal(homeDiscoveryCandidates(db).items.length,0);
  assert.throws(()=>verificationContext(db,'signal:older'),{code:'CANDIDATE_NOT_FOUND'});
  assert.throws(()=>candidateContext(db,'signal:older'),{code:'CANDIDATE_NOT_FOUND'});
 }finally{db.close();}
});
test('product workflow priority is applied before the 50-card cutoff, leaving baseline ordering unchanged',()=>{
 const db=openDatabase();try{
  db.put('sources',{...source,id:'zz-workflow',url:'https://workflow.example/1'});
  for(let i=0;i<60;i++){
   const words=createHash('sha256').update(String(i)).digest('hex').slice(0,32).replace(/\d/g,d=>String.fromCharCode(103+Number(d))).match(/.{8}/g).join(' ');
   db.put('sources',{id:'a'+String(i).padStart(3,'0'),title:words+' upload error',description:'I cannot upload this file. I have to try again.',url:'https://support.example/'+i,status:'new'});
  }
  const baseline=opportunityScanCandidates(db,{limit:50,maxSignals:1200});
  assert.ok(baseline.total>50);
  assert.ok(!baseline.items.some(x=>x.signalIds.includes('zz-workflow')));
  assert.ok(homeDiscoveryCandidates(db).items[0].signalIds.includes('zz-workflow'));
 }finally{db.close();}
});
