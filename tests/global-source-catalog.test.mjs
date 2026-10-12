import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {CATALOG,catalogList,installCatalogFeed} from '../src/source-catalog.mjs';
test('Product Hunt is an opt-in competitor feed, not a claim of firsthand demand',()=>{
 const store=openDatabase();try{
  const ph=CATALOG.find(x=>x.id==='ph-launches');
  assert.equal(ph.url,'https://www.producthunt.com/feed');assert.equal(ph.signalType,'competitive_launch');
  const before=catalogList(store).find(x=>x.id===ph.id);assert.equal(before.verifiedLive,false);
  const installed=installCatalogFeed(store,ph.id);assert.equal(installed.item.url,ph.url);
  assert.equal(catalogList(store).find(x=>x.id===ph.id).installedFeedId,installed.item.id);
 }finally{store.close()}
});
test('Reddit and X remain visible manual research sources and cannot be silently subscribed',()=>{
 const store=openDatabase();try{
  for(const id of ['reddit-research','x-social']){
   const source=catalogList(store).find(x=>x.id===id);assert.equal(source.accessMode,'manual');
   assert.ok(source.url.startsWith('https://'));
   assert.throws(()=>installCatalogFeed(store,id),{code:'CATALOG_MANUAL_ONLY'});
  }
  assert.equal(store.list('feeds').length,0);
 }finally{store.close()}
});
test('additional international community feeds stay opt-in',()=>{
 const ids=['apple-askdifferent','android-enthusiasts','ux-stackexchange'];
 for(const id of ids){const x=CATALOG.find(c=>c.id===id);assert.ok(x);assert.match(x.url,/^https:\/\//);assert.notEqual(x.accessMode,'manual')}
});

test('third-party Reddit and X RSS templates require explicit opt-in and preserve provenance',()=>{
 const store=openDatabase();try{
  for(const id of ['openrss-reddit-saas','openrss-reddit-sideproject','rsshub-x-diygod']){
   const c=catalogList(store).find(x=>x.id===id);assert.equal(c.accessMode,'experimental_rss');assert.equal(c.verifiedLive,false);
   assert.throws(()=>installCatalogFeed(store,id),{code:'EXPERIMENTAL_SOURCE_CONFIRMATION_REQUIRED'});
   const installed=installCatalogFeed(store,id,{acceptExperimentalRisk:true});
   assert.equal(installed.item.accessMode,'experimental_rss');
   assert.equal(installed.item.provider,c.provider);
   assert.equal(installed.item.catalogId,id);
   assert.equal(installCatalogFeed(store,id,{acceptExperimentalRisk:true}).alreadyInstalled,true);
  }
 }finally{store.close()}
});
