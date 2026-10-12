import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {firsthandHint,verificationContext,verifyProblem} from '../src/problem-verification.mjs';
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
