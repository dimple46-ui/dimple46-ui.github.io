// PRIVATE local-only calculation. No persistence, quote replacement or public Worker import.
import {evaluateAssetLedger} from './asset-ledger-contract.mjs';
const empty=()=>({baseNetAssetsKrw:null,stressedSecuritiesValueKrw:null,stressedGrossAssetsKrw:null,
 stressedNetAssetsKrw:null,netAssetChangeKrw:null,scenarioLossKrw:null});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function evaluateAssetStress(ledger,prices,scenario,policy){
 const base=evaluateAssetLedger(ledger,prices,policy),issues=[];
 const blocked=()=>({contractVersion:1,status:'BLOCKED',scope:'PRIVATE_LOCAL_SCENARIO_ONLY',
  inputCutoffMs:ledger?.asOfMs??null,totals:empty(),issues});
 if(base.status==='BLOCKED') {issues.push({code:'BASE_LEDGER_BLOCKED'});return blocked();}
 if(scenario?.schemaVersion!==1||typeof scenario.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scenario.id)||
   !plain(scenario.shocksBps)) {issues.push({code:'INVALID_EXPLICIT_SCENARIO'});return blocked();}
 for(const [ticker,bps] of Object.entries(scenario.shocksBps))
  if(!/^\d{6}$/.test(ticker)||!Number.isInteger(bps)||bps < -10000||bps > 10000)
   issues.push({code:'INVALID_SCENARIO_SHOCK'});
 let stressed=0n;
 for(const account of ledger.accounts) for(const h of account.holdings){
  if(h.quantity===0)continue;
  if(!Object.hasOwn(scenario.shocksBps,h.ticker)) {issues.push({code:'HELD_TICKER_SHOCK_REQUIRED'});continue;}
  const bps=scenario.shocksBps[h.ticker];
  if(!Number.isInteger(bps)||bps < -10000||bps > 10000)continue;
  // Floor each account/ticker valuation to whole KRW using exact integer arithmetic.
  // Shocked values are model outputs, never fabricated VERIFIED market quotes.
  stressed+=BigInt(h.quantity)*BigInt(prices[h.ticker].priceKrw)*BigInt(10000+bps)/10000n;
 }
 if(issues.length)return blocked();
 const cash=BigInt(base.totals.grossAssetsKrw-base.totals.securitiesValueKrw);
 const gross=stressed+cash,net=gross-BigInt(base.totals.debtPrincipalKrw);
 const delta=net-BigInt(base.totals.netAssetsKrw),loss=delta<0n?-delta:0n;
 const values=[stressed,gross,net,delta,loss];
 if(values.some(n=>n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))){
  issues.push({code:'ARITHMETIC_OVERFLOW'});return blocked();
 }
 return {contractVersion:1,status:'CALCULATED',scope:'PRIVATE_LOCAL_SCENARIO_ONLY',scenarioId:scenario.id,
  inputCutoffMs:ledger.asOfMs,generatedAtMs:policy.nowMs,currency:'KRW',
  totals:{baseNetAssetsKrw:base.totals.netAssetsKrw,stressedSecuritiesValueKrw:Number(stressed),
   stressedGrossAssetsKrw:Number(gross),stressedNetAssetsKrw:Number(net),netAssetChangeKrw:Number(delta),scenarioLossKrw:Number(loss)},
  issues:[],assumptions:['EXPLICIT_PRICE_SHOCKS_BPS_NOT_PROBABILITIES','CASH_AND_DEBT_PRINCIPAL_UNCHANGED',
   'FLOOR_WHOLE_KRW_PER_ACCOUNT_TICKER','NO_ASSET_SALE_OR_NEW_BORROWING'],
  limitations:['FICTIONAL_FIXTURE_VALIDATION_ONLY','NO_COLLATERAL_TAX_INTEREST_FX_OR_LIQUIDITY_MODEL',
   'NO_RISK_LIMIT_OR_TRADE_RECOMMENDATION','NOT_CONNECTED_TO_PRIVATE_STORAGE_OR_PRODUCTION']};
}
