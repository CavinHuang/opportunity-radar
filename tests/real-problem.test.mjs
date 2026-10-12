import test from 'node:test';import assert from 'node:assert/strict';
import {assessRealProblem} from '../src/real-problem.mjs';
import {openDatabase} from '../src/db.mjs';
import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
const examples=[
 {title:'Best AI automation tools for developers',description:'A list of popular tools for 2026',expect:false},
 {title:'We launched an AI invoicing tool',description:'Our team announces our new product today',expect:false},
 {title:'Looking for an alternative invoice app',description:'Any recommendations?',expect:false},
 {title:'Cannot automate repetitive receipts workflow',description:'I spend hours manually copying receipts between tools each day.',expect:true},
 {title:'每周报销单同步失败',description:'我们财务团队每周手动录入报销单，系统同步失败，需要反复复制数据。',expect:true},
 {title:'We are hiring an engineer',description:'We have a job for a developer who will debug our app',expect:false}
];
test('concrete problem gate rejects vague topics, launches and jobs',()=>{for(const e of examples){assert.equal(assessRealProblem(e).qualified,e.expect,e.title)}});
test('home candidate discovery excludes shallow AI opportunities even if they have matching keywords',()=>{
 const db=openDatabase();try{
 examples.forEach((e,i)=>db.put('sources',{id:'p'+i,title:e.title,description:e.description,url:'https://forum.example/post/'+i,status:'new',createdAt:'2026-10-12T00:00:00Z'}));
 const result=opportunityScanCandidates(db,{limit:30});
 assert.ok(result.total>=1);
 assert.ok(result.insufficientEvidence>=4);
 assert.ok(result.items.every(c=>c.problemEvidence.qualifiedSignals.length>=1));
 assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
