// Read-only integration description; never disclose tokens or imply that an external process is online.
export function agentSetupSummary(projectId, project, { enabled = false, serverTime = new Date().toISOString(), tools = [] } = {}) {
  const tasks=project?.tasks||[],stamp=Date.parse(serverTime);
  const freshReport=project?.agentLastSync?Date.parse(project.agentLastSync):NaN;
  const paused=Boolean(project&&['paused','stopped','archived'].includes(project.status));
  const lastSync=project?.agentLastSync??null;
  const minutesSinceReport=Number.isFinite(freshReport)?Math.max(0,Math.floor((stamp-freshReport)/60000)):null;
  const freshness=paused?'paused':!lastSync?'never_reported':minutesSinceReport>=30?'stale':'recent_report';
  return {
    projectId:projectId||null,enabled:Boolean(enabled),protocol:'MCP (stdio / HTTP)',mcpPath:'/mcp',
    toolCount:tools.length,toolNames:[...tools],lastSync,minutesSinceReport,freshness,
    // A valid lease records authorization, NOT whether a process still exists.
    activeLeases:tasks.filter(t=>t.lease&&Date.parse(t.lease.expiresAt)>stamp).length,
    expiredLeases:tasks.filter(t=>t.lease&&Date.parse(t.lease.expiresAt)<=stamp).length,
    openTasks:tasks.filter(t=>['open','rework'].includes(t.status)).length,
    reworkTasks:tasks.filter(t=>t.status==='rework').length,
    blockedTasks:tasks.filter(t=>t.status==='blocked').length,
    pendingSubmissions:(project?.submissions||[]).filter(s=>s.acceptanceState==='pending').length,
    pendingDecisions:(project?.decisions||[]).filter(d=>d.status==='pending').length,
    serverTime,paused,
    externalProcessState:'unknown',
    auth:{transport:'Bearer',configured:Boolean(enabled),secretExposed:false}
  };
}
