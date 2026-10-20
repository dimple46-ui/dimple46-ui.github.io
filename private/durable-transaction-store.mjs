// Provider bridge only. No SQL, schema, owner, key or epoch is initialized here.
import {createPrivateTransactionStore} from './transaction-store.mjs';

export function createDurablePrivateTransactionStore(storage){
 if(typeof storage?.sql?.exec!=='function'||typeof storage?.transactionSync!=='function')
  throw new TypeError('PRIVATE_SQLITE_PROVIDER_REQUIRED');
 // Cloudflare methods depend on their own receivers; do not pass unbound methods.
 const exec=storage.sql.exec.bind(storage.sql);
 const transactionSync=storage.transactionSync.bind(storage);
 return Object.freeze(createPrivateTransactionStore({sql:{exec},transactionSync}));
}
