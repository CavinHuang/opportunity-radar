import {scanSources,sourceHealth} from './source-hub.mjs';

// The database stores per-feed due times. A restarted process resumes from those times.
// An overdue feed is attempted once on the next tick; a failure persists its backoff.
export function createSourceScheduler(store,{scan=scanSources,clock=Date.now,logger=console,intervalMs=60_000}={}){
  let timer=null,running=false,stopped=false;
  async function tick(){
    if(stopped||running||sourceHealth(store,clock()).due===0)return {skipped:true};
    running=true;
    try{
      const result=await scan(store,{onlyDue:true,nowMs:clock()});
      if(result.feeds)logger.info?.(`[Radar sources] ${result.feeds} feeds, +${result.added} signals, ${result.errors.length} failed`);
      return result;
    }catch(e){
      if(e.code==='SCAN_IN_PROGRESS')return {skipped:true};
      logger.error?.('[Radar sources] '+e.message);return {error:e.message};
    }finally{running=false;}
  }
  return {
    tick,
    start(){if(timer)return;stopped=false;timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();queueMicrotask(()=>void tick());},
    stop(){stopped=true;if(timer)clearInterval(timer);timer=null;},
    get running(){return running;}
  };
}
