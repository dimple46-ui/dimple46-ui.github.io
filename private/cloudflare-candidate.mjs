// Closed candidate entry. This does not connect identity, private intake or approval.
import {DurableObject} from 'cloudflare:workers';
import {createDurablePrivateTransactionStore} from './durable-transaction-store.mjs';

const unavailable=()=>new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});

export class PrivateRiskStore extends DurableObject {
 #store;
 constructor(ctx,env){
  super(ctx,env);
  this.#store=createDurablePrivateTransactionStore(ctx?.storage);
 }
 // No store, bootstrap, SQL or approval method is exposed through RPC or HTTP.
 fetch(){return unavailable();}
}

// Do not resolve a namespace, inspect a credential/body, or instantiate an actor.
export default Object.freeze({fetch(){return unavailable();}});
