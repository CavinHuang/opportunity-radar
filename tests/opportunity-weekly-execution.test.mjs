import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
import {saveWeeklyResearchPlan,weeklyResearchPlan,reviewWeeklyResearchPlan} from '../src/opportunity-weekly-plan.mjs';
import {updateWeeklyResearchProgress,weeklyResearchTrend,carryPreviousWeekTasks} from '../src/opportunity-weekly-execution.mjs';
const first={now:new Date('2026-10-13T12:00:00Z')};
const second={now:new Date('2026-10-20T12:00:00Z')};
const seed=db=>{
 db.put('sources',{id:'one',status:'new',url:'https://example.org/problem',title:'I cannot reconcile invoice records manually',description:'I manually reconcile invoices every day and spend hours fixing errors'});
 return opportunityScanCandidates(db).items[0].id;
};
const assignment=id=>({candidateId:id,task:'核查真实用户的发票处理障碍和替代方案',hours:3,budget:20});
test('progress tracks actual reports, rejects stale revisions, preserves history and closes',()=>{
 const db=openDatabase();try{
  const id=seed(db);
  saveWeeklyResearchPlan(db,{expected_revision:0,items:[assignment(id)]},first);
  const p=updateWeeklyResearchProgress(db,{candidateId:id,status:'blocked',note:'找不到明确愿意参与访谈的用户，需要改进招募',actualHours:1,expected_revision:1},first);
  assert.equal(p.progress.length,1);
  assert.equal(weeklyResearchPlan(db,first).progress[0].status,'blocked');
  assert.throws(()=>updateWeeklyResearchProgress(db,{candidateId:id,status:'completed',note:'本周已经完成了初步验证和跟进',actualHours:2,expected_revision:1},first),{code:'REVISION_CONFLICT'});
  assert.throws(()=>saveWeeklyResearchPlan(db,{expected_revision:2,items:[{...assignment(id),task:'改成完全不同的任务内容进行替换'}]},first),{code:'PROGRESS_EXISTS'});
  reviewWeeklyResearchPlan(db,{expected_revision:2,notes:'人工汇总真实障碍与本周全部工作进度',results:[{candidateId:id,status:'blocked',actualHours:1,actualCost:0,observation:'仍未找到足够可核查的独立用户'}]},first);
  assert.throws(()=>updateWeeklyResearchProgress(db,{candidateId:id,status:'completed',note:'事后更新进度信息不应成功',actualHours:2,expected_revision:3},first),{code:'NO_ACTIVE_WEEK'});
  const trend=weeklyResearchTrend(db);
  assert.equal(trend.closedWeeks,1);
  assert.equal(trend.weeks[0].blocked,1);
  assert.equal(trend.weeks[0].actualHours,1);
  assert.equal(trend.weeks[0].progressEvents,1);
 }finally{db.close();}
});
test('manual carry forwards only selected, live previous-week tasks and preserves history',()=>{
 const db=openDatabase();try{
  const id=seed(db);
  saveWeeklyResearchPlan(db,{expected_revision:0,items:[assignment(id)]},first);
  const carried=carryPreviousWeekTasks(db,{candidateIds:[id],expected_revision:0},second);
  assert.equal(carried.weekStart,'2026-10-19');
  assert.equal(carried.items[0].candidateId,id);
  assert.equal(weeklyResearchPlan(db,first).weekStart,'2026-10-12');
  assert.throws(()=>carryPreviousWeekTasks(db,{candidateIds:[id],expected_revision:1},second),{code:'WEEK_HAS_PLAN'});
  const trend=weeklyResearchTrend(db);
  assert.equal(trend.weeks.length,2);
  assert.equal(trend.weeks[1].actualHours,null);
  assert.equal(trend.weeks[1].conclusionRate,null);
 }finally{db.close();}
});
test('cannot carry nonexistent prior task or write progress without a plan',()=>{
 const db=openDatabase();try{
  assert.throws(()=>carryPreviousWeekTasks(db,{candidateIds:['unknown'],expected_revision:0},second),{code:'NO_PREVIOUS_WEEK'});
  assert.throws(()=>updateWeeklyResearchProgress(db,{candidateId:'unknown',status:'blocked',note:'无法核实这个问题是否真实存在',actualHours:1,expected_revision:0},first),{code:'NO_ACTIVE_WEEK'});
 }finally{db.close();}
});
