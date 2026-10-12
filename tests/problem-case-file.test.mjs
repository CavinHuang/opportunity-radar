import test from 'node:test';import assert from 'node:assert/strict';
import {problemCaseFile} from '../src/real-problem.mjs';import {openDatabase} from '../src/db.mjs';import {opportunityScanCandidates} from '../src/opportunity-scan.mjs';
test('problem case extracts only actual text and displays unknowns',()=>{
 const x=problemCaseFile({title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices between tools every day and spend 2 hours doing it.'});
 assert.equal(x.qualified,true);assert.match(x.signals.workaround.quote,/manually/i);assert.ok(x.signals.frequency);assert.ok(x.signals.impact);assert.equal(x.stage,'needs_owner_verification');
 const vague=problemCaseFile({title:'Best AI agents tools',description:'Our product launch announcement'});
 assert.equal(vague.qualified,false);assert.equal(vague.signals.workaround,null);
});
test('ranking reflects concrete pain evidence not source count or AI buzzwords',()=>{
 const db=openDatabase();try{
  db.put('sources',{id:'strong',title:'Cannot automate repetitive invoice workflow',description:'I manually copy invoices in spreadsheets every day and spend 2 hours fixing errors.',status:'new',url:'https://example.org/strong'});
  db.put('sources',{id:'thin',title:'Cannot automate manual invoice workflow',description:'I need alternative tools.',status:'new',url:'https://example.net/thin'});
  const list=opportunityScanCandidates(db,{limit:12}).items;
  assert.ok(list.length);assert.ok(list[0].problemCase?.signals?.task);assert.ok(list[0].problemCase?.signals?.obstacle);
  assert.equal(db.list('opportunities').length,0);
 }finally{db.close()}
});
