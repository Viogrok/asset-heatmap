/** Background work must never hold the quote/heartbeat delivery loop. */
export class NonOverlappingTask {
 private pending:Promise<void>|null=null;
 private onError:(error:unknown)=>void;
 constructor(onError:(error:unknown)=>void=()=>{}){this.onError=onError;}
 run(work:()=>void|Promise<void>):boolean{
  if(this.pending)return false;
  this.pending=Promise.resolve().then(work).catch(this.onError).finally(()=>{this.pending=null;});
  return true;
 }
 wait():Promise<void>{return this.pending||Promise.resolve();}
 get running(){return this.pending!==null;}
}

/** Normal rotation closes the response only after ownership cleanup completes. */
export class CloseBarrier {
 private pending:Promise<void>|null=null;
 close(release:()=>Promise<void>,finish:()=>void):Promise<void>{
  if(!this.pending)this.pending=Promise.resolve().then(release).finally(finish);
  return this.pending;
 }
}
