import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceQuotationContext} from '../src/evidence-quotations.mjs';
import {validateEvidenceComparison} from '../src/opportunity-evidence-comparison.mjs';
const originals=[{sourceId:'source-a',url:'https://example.org/original',title:'Cannot import CSV into Excel',text:'I manually import CSV every day and spend 3 hours fixing errors.'}];
const hit={url:'https://example.org/external',title:'CSV &amp; Excel workaround',excerpt:'I can&#x27;t import&nbsp;CSV &gt; 10MB. The importer still needs manual fixes.'};
const verdict=()=>({taskRelation:'same_task',relationReason:'输入片段可能描述同一任务，仍需核查。',originalEvidence:{quoteId:'o1-2'},externalEvidence:{quoteId:'x-2'},
 solutionCoverage:'reported_partial',coverageReason:'片段报告仍需手动处理，尚未核查功能。',coverageQuoteId:'x-2',nextCheck:'用原帖数据检查是否仍需人工修复。'});

test('encoded external text becomes readable before both prompting and quote validation',()=>{
 const c=evidenceQuotationContext(originals,hit);
 assert.equal(c.external.title,'CSV & Excel workaround');
 assert.equal(c.external.excerpt,"I can't import CSV > 10MB. The importer still needs manual fixes.");
 assert.equal(c.quotations.external[1].quote,c.external.excerpt);
 assert.equal(new Set([...c.quotations.original,...c.quotations.external].map(x=>x.quoteId)).size,4);
});
test('indexed quotations expand only server-supplied text, source identity and original links',()=>{
 const v=verdict();v.externalEvidence.url='https://untrusted.example';
 const c=validateEvidenceComparison(v,originals,hit);
 assert.equal(c.originalEvidence.sourceId,'source-a');assert.equal(c.originalEvidence.url,originals[0].url);
 assert.equal(c.originalEvidence.quote,originals[0].text);assert.equal(c.externalEvidence.url,hit.url);
 assert.equal(c.externalEvidence.quote,"I can't import CSV > 10MB. The importer still needs manual fixes.");
 assert.equal(c.coverageQuote,c.externalEvidence.quote);assert.equal(c.coverageQuoteId,'x-2');
});
test('unknown, swapped, changed-text and wrong-source quote IDs remain rejected',()=>{
 for(const patch of [{originalEvidence:{quoteId:'x-2'}},{externalEvidence:{quoteId:'o1-2'}},
  {externalEvidence:{quoteId:'x-999'}},{coverageQuoteId:'o1-2'},
  {originalEvidence:{quoteId:'o1-2',sourceId:'other-source'}},
  {externalEvidence:{quoteId:'x-2',quote:'The importer solves all problems'}}])
  assert.throws(()=>validateEvidenceComparison({...verdict(),...patch},originals,hit),{code:'LLM_UNGROUNDED_QUOTE'});
});
test('literal readable quotes survive entity decoding but paraphrases and unsupported coverage do not',()=>{
 const v={...verdict(),originalEvidence:{sourceId:'source-a',quote:originals[0].text},externalEvidence:{quote:"I can't import CSV > 10MB."},coverageQuoteId:'',solutionCoverage:'unknown'};
 assert.equal(validateEvidenceComparison(v,originals,hit).externalEvidence.quote,v.externalEvidence.quote);
 assert.throws(()=>validateEvidenceComparison({...v,externalEvidence:{quote:"I can import CSV > 10MB."}},originals,hit),{code:'LLM_UNGROUNDED_QUOTE'});
 assert.throws(()=>validateEvidenceComparison({...v,solutionCoverage:'reported_full'},originals,hit),{code:'LLM_UNGROUNDED_QUOTE'});
});
test('long multilingual quotations remain bounded contiguous excerpts without broken Unicode',()=>{
 const text='导入错误😀'.repeat(150);
 const c=evidenceQuotationContext([{...originals[0],text}],hit);
 const parts=c.quotations.original.slice(1);
 assert.ok(parts.length>2);
 for(const x of parts){assert.ok(x.quote.length>=8&&x.quote.length<=240);assert.ok(text.includes(x.quote));assert.doesNotMatch(x.quote,/[\uD800-\uDFFF]/u);}
});
test('segmentation retains short trailing constraints instead of silently dropping them',()=>{
 const text='x'.repeat(240)+' NOT';
 const c=evidenceQuotationContext([{...originals[0],text}],hit);
 assert.ok(c.quotations.original.some(x=>x.quote.endsWith('NOT')));
 for(const x of c.quotations.original)assert.ok(x.quote.length>=8&&x.quote.length<=240);
});
