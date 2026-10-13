// Stateless MCP 2026-07-28 transport plus legacy stdio compatibility.
// The business owner stays the Radar service; protocol state never grants project authority.
import {readFileSync} from 'node:fs';
export const MCP_VERSION = '2026-07-28';
export const LEGACY_VERSION = '2025-11-25';
// 版本号单一来源是 package.json；此前三处硬编码互相矛盾（1.2.0 / 0.3.0 / 实际版本）。
export const SERVER_VERSION=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
// P0 未启用的已知工具：明确报 CAPABILITY_DISABLED，而不是伪装成 Unknown tool。
const DISABLED_TOOLS=new Set(['collaboration.handoff']);
const object = (properties, required=[]) => ({type:'object',properties,required,additionalProperties:true});
const str={type:'string'};const integer={type:'integer',minimum:1};
const definitions={
  'project.get_context':object({project_id:str},['project_id']),
  'project.get_next_work':object({project_id:str},['project_id']),
  'project.watch_changes':object({project_id:str,cursor:{type:'integer',minimum:0}},['project_id']),
  'task.claim':object({project_id:str,task_id:str,baseline_revision:integer,expected_revision:integer,lease_token:str,recovery_checked:{type:'boolean'},recovery_note:str,idempotency_key:str},['project_id','task_id','idempotency_key']),
  'task.upsert':object({project_id:str,milestone_id:str,task_id:str,title:str,description:str,dependencies:{type:'array',items:str},expected_revision:integer,lease_token:str,idempotency_key:str},['project_id','title','idempotency_key']),
  'task.transition':object({task_id:str,status:{type:'string',enum:['in_progress','blocked','submitted','rework']},blocked_reason:str,expected_revision:integer,lease_token:str,idempotency_key:str},['task_id','status','expected_revision','lease_token','idempotency_key']),
  'task.release':object({task_id:str,expected_revision:integer,lease_token:str,idempotency_key:str},['task_id','expected_revision','lease_token','idempotency_key']),
  'progress.report':object({project_id:str,task_id:str,summary:str,risks:{type:'array',items:str},limitations:{type:'array',items:str},lease_token:str,idempotency_key:str},['project_id','summary','idempotency_key']),
  'evidence.attach':object({project_id:str,milestone_id:str,task_id:str,type:str,source_uri:str,repo:str,commit_sha:str,criteria_ids:{type:'array',items:str},idempotency_key:str},['project_id','type','idempotency_key']),
  'issue.raise_blocker':object({project_id:str,summary:str,options:{type:'array',items:str},idempotency_key:str},['project_id','summary','idempotency_key']),
  'decision.request':object({project_id:str,kind:str,summary:str,impact:str,alternatives:{type:'array',items:str},idempotency_key:str},['project_id','kind','summary','idempotency_key']),
  'handoff.submit':object({project_id:str,milestone_id:str,baseline_revision:integer,commit_sha:str,evidence_ids:{type:'array',items:str},preview_link:str,known_gaps:{type:'array',items:str},idempotency_key:str},['project_id','milestone_id','baseline_revision','idempotency_key'])
};
const explanations={
  'project.get_context':'获取当前已批准的项目基线、里程碑和交付上下文。',
  'project.get_next_work':'取得依赖已经满足且可以领取的执行任务。',
  'project.watch_changes':'按游标增量读取已提交的项目事实变更。',
  'task.claim':'领取任务；携带当前 lease_token 可以续期。旧租约到期后接管必须核对外部执行。',
  'task.upsert':'在获准的里程碑内新建或更新执行任务；更新需有效租约及修订号。',
  'task.transition':'汇报执行任务状态；置为阻塞时必须提供 blocked_reason。提交并不代表产品验收。',
  'task.release':'释放任务责任，不能声称外部进程已经停止。',
  'progress.report':'报告项目或单个任务的进度与风险说明；进度自报不改变任务状态，不能替代人工验收。',
  'evidence.attach':'提交与交付版本关联的证据，默认待核验。',
  'issue.raise_blocker':'报告阻塞及可选解决方式。',
  'decision.request':'申请改变预算、范围或验收等受保护的事项。',
  'handoff.submit':'提交里程碑交付，申请证据核验和用户验收。'
};
export function listMcpTools(service){return service.tools.map(name=>({name,description:explanations[name],inputSchema:definitions[name]}));}
/** 入参校验：required 字段缺失时返回可读错误，缺参不再以 undefined 直达存储层。 */
export function invalidToolArguments(name,args){
 const schema=definitions[name];
 if(!schema)return null;
 const missing=(schema.required||[]).filter(k=>args?.[k]===undefined||args?.[k]===null||args?.[k]==='');
 return missing.length?`missing required argument(s): ${missing.join(', ')}`:null;
}
export function dispatchMcp(service, request,{legacy=false}={}){
  const id=request?.id;
  const rpcError=(code,message,data)=>({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}});
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string'||Array.isArray(request))return rpcError(-32600,'Invalid Request');
  const p=request.params||{};
  if(request.method==='initialize' && legacy) return {jsonrpc:'2.0',id,result:{protocolVersion:LEGACY_VERSION,serverInfo:{name:'opportunity-radar',version:SERVER_VERSION},capabilities:{tools:{listChanged:false}}}};
  if(request.method==='notifications/initialized'&&legacy)return null;
  if(request.method==='server/discover')return {jsonrpc:'2.0',id,result:{serverInfo:{name:'opportunity-radar',version:SERVER_VERSION},capabilities:{tools:{listChanged:false}}}};
  if(request.method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(request.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:listMcpTools(service)}};
  if(request.method==='tools/call'){
    if(!service.tools.includes(p.name)&&!DISABLED_TOOLS.has(p.name))return rpcError(-32602,'Unknown tool');
    if(!p.arguments||typeof p.arguments!=='object'||Array.isArray(p.arguments))return rpcError(-32602,'Tool arguments must be an object');
    const invalid=invalidToolArguments(p.name,p.arguments);
    if(invalid)return rpcError(-32602,`Invalid arguments for ${p.name}: ${invalid}`);
    try{
      const result=service.tool(p.name,p.arguments);
      return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result},isError:false}};
    }catch(e){return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({error:e.code||'TOOL_ERROR',message:e.message})}],isError:true}};}
  }
  return rpcError(-32601,'Method not found');
}
export function validateModernMcp(request,headers){
  const version=headers['mcp-protocol-version'];
  if(version!==MCP_VERSION)return {status:400,code:-32022,message:'Unsupported protocol version',data:{supported:[MCP_VERSION],requested:version||null}};
  const p=request?.params||{};
  if(headers['mcp-method']!==request?.method)return {status:400,code:-32020,message:'Header mismatch: Mcp-Method'};
  if(request?.method==='tools/call'&&headers['mcp-name']!==p.name)return {status:400,code:-32020,message:'Header mismatch: Mcp-Name'};
  if(p?._meta?.['io.modelcontextprotocol/protocolVersion']!==version)return {status:400,code:-32020,message:'Header mismatch: protocolVersion in _meta'};
  if(!p?._meta?.['io.modelcontextprotocol/clientInfo']?.name)return {status:400,code:-32602,message:'Missing clientInfo'};
  return null;
}
