import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {weekMonday,weeklyResearchPlan,saveWeeklyResearchPlan,reviewWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
const at={now:new Date('2026-10-13T12:00:00Z')};
function setup(db){
 db.put('sources',{id:'invoice',status:'new',url:'https://example.org/invoice',
 title:'I cannot reconcile invoice records manually',
 description:'I manually reconcile invoice records daily and spend hours correcting errors'});
 return opportunityScanCandidates(db).items[0].id;
}
test('weekly plan manually saves selected candidates and locks a reviewed week',()=>{
 const db=openDatabase();try{
 const id=setup(db),board=weeklyResearchPlan(db,at);
 assert.equal(weekMonday(at.now),'2026-10-12');
 assert.equal(board.revision,0);
 const item={candidateId:id,task:'访问有真实发票对账问题的用户并核实重复成本',hours:3,budget:80};
 const saved=saveWeeklyResearchPlan(db,{expected_revision:0,items:[item]},at);
 assert.equal(saved.revision,1);
 assert.equal(weeklyResearchPlan(db,at).items[0].available,true);
 const reviewed=reviewWeeklyResearchPlan(db,{expected_revision:1,
 notes:'本周完成了原帖核对，但无法确认潜在的付费行为。',
 results:[{candidateId:id,status:'inconclusive',actualHours:2,actualCost:10,observation:'只确认有实际工作障碍，仍缺付费证据'}]},at);
 assert.equal(reviewed.status,'reviewed');
 assert.equal(reviewed.review.results[0].actualHours,2);
 assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:2,items:[item]},at),{code:'WEEK_CLOSED'});
 assert.throws(()=>reviewWeeklyResearchPlan(db,{expected_revision:2,notes:'重复',results:[]},at),{code:'NO_WEEK_PLAN'});
 }finally{db.close();}
});
test('selection rejects duplicates and stale or non-candidate IDs',()=>{
 const db=openDatabase();try{
 const id=setup(db),item={candidateId:id,task:'核实这个候选是否存在真实反复问题',hours:2,budget:0};
 assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:0,items:[item,item]},at),{code:'INVALID_CANDIDATE'});
 assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:0,items:[{...item,candidateId:'nonexistent'}]},at),{code:'INVALID_CANDIDATE'});
 assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:0,items:[{...item,hours:0}]},at),{code:'INVALID_PLAN'});
 assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:1,items:[item]},at),{code:'REVISION_CONFLICT'});
 }finally{db.close();}
});
test('empty week does not invent assignments',()=>{
 const db=openDatabase();try{
 const b=weeklyResearchPlan(db,at);
 assert.deepEqual(b.items,[]);
 assert.equal(b.status,'draft');
 }finally{db.close();}
});
