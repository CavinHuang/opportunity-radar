/**
 * Shared, idempotent shutdown for Docker/Dokploy SIGTERM and interactive SIGINT.
 *
 * Stop write-capable background jobs *before* HTTP closes. The scheduler's
 * current asynchronous fetch is not aborted here; it can finish normally.
 * Do not force process.exit(), which would bypass Node's normal IO cleanup.
 */
export function createServiceShutdown({server,scheduler,productionGuard,onCloseError=console.error}){
 let requested=false;
 return ()=>{
  if(requested)return false;
  requested=true;
  scheduler.stop();
  productionGuard.stop();
  server.close(err=>{if(err)onCloseError(err);});
  return true;
 };
}
