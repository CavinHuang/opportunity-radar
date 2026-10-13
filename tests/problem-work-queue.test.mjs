import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {problemWorkQueue} from '../src/problem-work-queue.mjs';
test('empty data remains empty without artificial action items',()=>{const db=openDatabase();try{const q=problemWorkQueue(db);assert.equal(q.discover.count,0);assert.equal(q.validate.count,0);assert.equal(q.conclude.count,0);}finally{db.close()}});
test('only AI-retained problem signals produce first-review tasks; rejected do not',()=>{
 const db=openDatabase();try{
 db.put('sources',{id:'a',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices every day, spending hours fixing errors',url:'https://forum.example/a',status:'new'});
 db.put('home_opportunity_scans',{id:'latest',status:'filtered',items:[{id:'signal:a'}]});
 assert.equal(problemWorkQueue(db).discover.count,1);
 db.put('home_opportunity_decisions',{id:'signal:a',action:'dismiss'});
 assert.equal(problemWorkQueue(db).discover.count,0);
 }finally{db.close()}
});
test('conclusions count real closed experiments and flag due dates',()=>{const db=openDatabase();try{
 db.put('problem_experiment_designs',{id:'d1',status:'closed',problemId:'signal:a',planId:'p1',decision:'stop',decisionReason:'Real task was already solved',currency:'CNY',budgetLimit:40,closedAt:'2026-10-01T00:00:00Z'});
 db.put('problem_decision_reviews',{id:'d1',nextStep:'recheck',assessment:'inconclusive',revisitAt:'2026-10-10',reason:'Need to check current workaround'});
 const q=problemWorkQueue(db,{today:'2026-10-13'});assert.equal(q.conclude.count,1);assert.equal(q.conclude.dueCount,1);assert.equal(q.conclude.items[0].decision,'recheck');
 }finally{db.close()}
});
