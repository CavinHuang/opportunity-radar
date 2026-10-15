import {plainSourceText} from './opportunity-brief.mjs';

function fragments(value){
 let rest=String(value||'').replace(/\s+/g,' ').trim();const items=[];
 while(rest){
  let end=Math.min(240,rest.length);
  if(end<rest.length){const space=rest.lastIndexOf(' ',end);if(space>=120)end=space;
   const tail=rest.slice(end).trim();if(tail.length>0&&tail.length<8)end-=8-tail.length;
   if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;}
  const quote=rest.slice(0,end).trim();if(quote.length>=8)items.push(quote);
  rest=rest.slice(end).trim();
 }
 return items;
}
/** Deterministic excerpts: the model selects IDs, the server supplies quote text and URLs. */
export function evidenceQuotationContext(originals,hit){
 const external={...hit,title:plainSourceText(hit.title),excerpt:plainSourceText(hit.excerpt)};
 const original=originals.flatMap((x,i)=>[...fragments(x.title),...fragments(x.text)].map((quote,j)=>({
  quoteId:`o${i+1}-${j+1}`,sourceId:x.sourceId,url:x.url,quote})));
 const matches=[...fragments(external.title),...fragments(external.excerpt)].map((quote,j)=>({quoteId:`x-${j+1}`,url:hit.url,quote}));
 return {external,quotations:{original,external:matches}};
}
