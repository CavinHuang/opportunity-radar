// Owner-facing read model. No invented completion or inferred publishing.
const count=(items,predicate)=>items.filter(predicate).length;
export function projectPipeline(project){
 const baseline=project.baselines?.at(-1);
 const tasks=(project.tasks||[]).filter(t=>!t.baselineRevision||t.baselineRevision===baseline?.revision);
 // Archived owner tasks are closed bookkeeping; they no longer count as open work.
 const ownerTasks=(project.ownerTasks||[]).filter(t=>!t.archivedAt);
 // Overdue compares the machine-local calendar day with the date-only dueDate,
 // matching the owner's local intent rather than the UTC day.
 const n=x=>String(x).padStart(2,'0');
 const nowDate=new Date();
 const today=`${nowDate.getFullYear()}-${n(nowDate.getMonth()+1)}-${n(nowDate.getDate())}`;
 const ownerOverdue=count(ownerTasks,t=>t.dueDate&&t.state!=='done'&&t.dueDate<today);
 const ownerTaskCounts=Object.fromEntries(['todo','doing','blocked','done'].map(s=>[s,count(ownerTasks,t=>t.state===s)]));
 const milestones=project.milestones||[],submissions=project.submissions||[],contents=project.contents||[];
 const taskCounts=Object.fromEntries(['open','in_progress','submitted','rework','blocked'].map(s=>[s,count(tasks,t=>t.status===s)]));
 const pendingAcceptance=count(submissions,s=>s.acceptanceState==='pending'&&s.baselineRevision===baseline?.revision);
 const pendingDecisions=count(project.decisions||[],d=>d.status==='pending');
 const accepted=count(milestones,m=>m.acceptanceState==='accepted');
 const publications=count(contents,c=>c.reviewState==='published');
 const approvals=count(contents,c=>c.reviewState==='approved'&&c.approvedRevision===c.revision);
 const drafts=count(contents,c=>c.reviewState==='draft');
 const stopped=['paused','stopped','archived'].includes(project.status);
 const nextActions=[];
 if(stopped)nextActions.push({kind:'project_state',label:'先确认主实验的暂停或停止状态',tab:'overview'});
 else {
  if(ownerOverdue)nextActions.push({kind:'owner_overdue',label:'处理已逾期的人工任务',tab:'tasks'});
  if(ownerTaskCounts.blocked)nextActions.push({kind:'owner_blocker',label:'处理人工规划任务中的阻塞',tab:'tasks'});
  if(pendingDecisions)nextActions.push({kind:'decision',label:'处理待批准的 Agent 决策',tab:'agent'});
  if(pendingAcceptance)nextActions.push({kind:'acceptance',label:'审核最新交付与证据后决定验收',tab:'evidence'});
  if(taskCounts.rework)nextActions.push({kind:'rework',label:'跟进被退回的任务',tab:'overview'});
  if(taskCounts.blocked)nextActions.push({kind:'blocked',label:'排查被阻塞任务及依赖',tab:'overview'});
  if(!tasks.length&&accepted<milestones.length)nextActions.push({kind:'kickoff',label:'准备首个研发任务',tab:'overview'});
  else if(taskCounts.open)nextActions.push({kind:'agent',label:'将待领取任务交给外部 Coding Agent',tab:'agent'});
  if(accepted===milestones.length&&milestones.length>0){
   if(approvals)nextActions.push({kind:'publish',label:'人工发布已批准内容并登记真实链接',tab:'launch'});
   else if(drafts)nextActions.push({kind:'review',label:'核对宣发事实与隐私后审批内容',tab:'launch'});
   else nextActions.push({kind:'draft',label:'准备第一份基于真实交付的宣发内容',tab:'launch'});
  }else if(drafts||approvals)nextActions.push({kind:'launch_blocked',label:'继续准备内容，产品交付尚未全部验收',tab:'launch'});
 }
 if(publications)nextActions.push({kind:'measure',label:'记录真实曝光、访问、试用与收入数据',tab:'ledger'});
 return {baselineRevision:baseline?.revision||null,taskCounts,totalTasks:tasks.length,
  ownerTaskCounts,ownerTaskTotal:ownerTasks.length,ownerOverdue,milestoneCounts:{total:milestones.length,accepted,pending:count(milestones,m=>m.acceptanceState==='pending'),rejected:count(milestones,m=>m.acceptanceState==='rejected')},
  pendingAcceptance,pendingDecisions,contentCounts:{drafts,approved:approvals,published:publications},
  // A work-in-progress count is not a credible percent-complete measure.
  progressLabel:`${accepted}/${milestones.length} 里程碑已人工验收`,
  launchReady:accepted===milestones.length&&milestones.length>0,
  nextActions:nextActions.slice(0,6)};
}
