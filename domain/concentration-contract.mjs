// PRIVATE local-only calculation over declared, validated positions. No allocation limits or tax rules.
import {evaluateAssetLedger} from './asset-ledger-contract.mjs';
const DENOMINATORS=['DECLARED_SECURITIES_VALUE','DECLARED_GROSS_ASSETS'];
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
export function evaluateConcentration(ledger,prices,{denominator,...ledgerPolicy}={}){
 if(!DENOMINATORS.includes(denominator))throw new Error('EXPLICIT_CONCENTRATION_DENOMINATOR_REQUIRED');
 const base=evaluateAssetLedger(ledger,prices,ledgerPolicy);
 const metadata={contractVersion:1,scope:'PRIVATE_DECLARED_ACCOUNT_CONCENTRATION_ONLY',
  inputCutoffMs:time(ledger?.asOfMs)&&ledger.asOfMs<=ledgerPolicy.nowMs?ledger.asOfMs:null,
  generatedAtMs:ledgerPolicy.nowMs,currency:'KRW',denominator,
  precision:'FLOOR_BASIS_POINTS_NOT_NORMALIZED',
  limitations:['DECLARED_ACCOUNTS_NOT_ENTIRE_WEALTH','GROSS_EXCLUDES_DEBT_DEDUCTION',
   'NO_PERSONAL_LIMIT_TAX_OR_TRADE_DECISION','NO_PRIVATE_STORAGE_OR_PUBLIC_ENDPOINT']};
 if(base.status==='BLOCKED')return {...metadata,status:'BLOCKED',denominatorKrw:null,perTicker:[],
  samsungHynixCombined:null,issues:[{code:'BASE_LEDGER_BLOCKED'}]};
 const denominatorKrw=denominator==='DECLARED_SECURITIES_VALUE'?base.totals.securitiesValueKrw:base.totals.grossAssetsKrw;
 const values=new Map();
 for(const account of ledger.accounts)for(const h of account.holdings){
  if(h.quantity===0)continue;
  values.set(h.ticker,(values.get(h.ticker)??0n)+BigInt(h.quantity)*BigInt(prices[h.ticker].priceKrw));
 }
 const ratio=value=>({valueKrw:Number(value),weightBps:denominatorKrw===0?null:
  Number(value*10000n/BigInt(denominatorKrw))});
 return {...metadata,status:denominatorKrw===0?'UNAVAILABLE':'CALCULATED',denominatorKrw,
  perTicker:[...values.keys()].sort().map(ticker=>({ticker,...ratio(values.get(ticker))})),
  samsungHynixCombined:{tickers:['005930','000660'],...ratio((values.get('005930')??0n)+(values.get('000660')??0n))},
  issues:denominatorKrw===0?[{code:'ZERO_DENOMINATOR'}]:[]};
}
