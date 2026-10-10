// Read-only integration description: never serialize auth tokens or environment secrets.
export function agentSetupSummary(projectId, project, { enabled = false, serverTime = new Date().toISOString(), tools = [] } = {}) {
  const tasks = project?.tasks || [];
  const leased = tasks.filter(t => t.lease && Date.parse(t.lease.expiresAt) > Date.parse(serverTime)).length;
  return {
    projectId: projectId || null,
    enabled: Boolean(enabled),
    protocol: 'MCP (stdio / HTTP)',
    mcpPath: '/mcp',
    toolCount: tools.length,
    toolNames: [...tools],
    lastSync: project?.agentLastSync ?? null,
    activeLeases: leased,
    openTasks: tasks.filter(t => ['open','rework'].includes(t.status)).length,
    pendingDecisions: (project?.decisions || []).filter(d => d.status === 'pending').length,
    serverTime,
    paused: project ? ['paused','stopped','archived'].includes(project.status) : false,
    auth: { transport: 'Bearer', configured: Boolean(enabled), secretExposed: false }
  };
}
