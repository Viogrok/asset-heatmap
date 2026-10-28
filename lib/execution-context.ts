import {AsyncLocalStorage} from 'node:async_hooks';
type Lifetime={waitUntil:(work:Promise<unknown>)=>void};
const current=new AsyncLocalStorage<Lifetime>();
export function runWithWorkerLifetime<T>(context:Lifetime,work:()=>T):T{return current.run({waitUntil:context.waitUntil.bind(context)},work);}
export function workerWaitUntil(){return current.getStore()?.waitUntil;}
