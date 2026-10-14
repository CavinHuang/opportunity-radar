import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const refreshSource=source.slice(source.indexOf('async function refresh(){'),source.indexOf('\n',source.indexOf('async function refresh(){')));

function harness(){
 const quality={counts:{usable:0,falsePositive:0,falseNegative:0},precision:null,recall:null};
 const requests=[];
 const rendered=[];
 const S={view:'brief',briefTab:'opportunities',signalStatus:'new',signalOffset:0,signalQuery:'',signalSourceId:'',booting:true};
 const context=vm.createContext({S,
  api:async path=>{requests.push(path);return path==='/home/problem-quality'?quality:{items:[],projects:[]};},
  render:()=>rendered.push(S.discoveryQuality),toast:()=>{},t:x=>x});
 vm.runInContext(refreshSource,context);
 return {S,quality,requests,rendered,context};
}

test('home refresh retains quality data through rendering, including zero labels and unknown accuracy',async()=>{
 const h=harness();
 await h.context.refresh();
 assert.equal(h.S.loadError,null);
 assert.equal(h.rendered.at(-1),h.quality);
 assert.equal(h.S.discoveryQuality.precision,null);
 assert.equal(h.S.discoveryQuality.counts.usable,0);
 assert.equal(h.requests.filter(p=>p==='/home/problem-quality').length,1);
});

test('switching between sources and home loads quality once per refresh and never clears the home panel',async()=>{
 const h=harness();
 h.S.briefTab='sources';
 await h.context.refresh();
 assert.equal(h.rendered.at(-1),h.quality);
 h.S.briefTab='opportunities';
 await h.context.refresh();
 assert.equal(h.rendered.at(-1),h.quality);
 assert.equal(h.requests.filter(p=>p==='/home/problem-quality').length,2);
});
