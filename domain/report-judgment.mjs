import {createHash} from 'node:crypto';
const requireValue=(ok,code)=>{if(!ok)throw new Error(code);};
const text=s=>typeof s==='string'&&s.trim().length>0;
const time=n=>Number.isSafeInteger(n)&&n>0;
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function document(d,cutoff){
 requireValue(text(d?.documentId)&&text(d?.issuerId)&&/^\d{6}$/.test(d?.ticker??''),'INVALID_REPORT_IDENTITY');
 requireValue(d.originalRead===true&&text(d.location)&&text(d.author)&&/^\d{4}-\d{2}-\d{2}$/.test(d.publishedDate??''),'ORIGINAL_SOURCE_REQUIRED');
 const date=Date.parse(`${d.publishedDate}T00:00:00Z`);
 requireValue(Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===d.publishedDate,'INVALID_PUBLICATION_DATE');
 requireValue(time(d.firstSeenAtMs)&&d.firstSeenAtMs<=cutoff&&date<=d.firstSeenAtMs,'FUTURE_OR_BACKDATED_SOURCE');
 let url;try{url=new URL(d.url);}catch{throw new Error('INVALID_SOURCE_URL');}
 requireValue(url.protocol==='https:'&&!url.username&&!url.password,'INVALID_SOURCE_URL');
 requireValue(d.fiscalPeriod==='2026Q2'||/^\d{4}Q[1-4]$/.test(d.fiscalPeriod??''),'INVALID_FISCAL_PERIOD');
 requireValue(d.scope==='CONSOLIDATED'&&d.currency==='KRW'&&d.unit==='KRW_BILLION','UNSUPPORTED_FINANCIAL_BASIS');
 requireValue(['PRELIMINARY_ESTIMATE','COMPANY_REPORTED'].includes(d.figureStatus),'INVALID_FIGURE_STATUS');
 requireValue(d.metrics&&Object.keys(d.metrics).length>0,'MISSING_REPORT_METRICS');
 for(const [k,v]of Object.entries(d.metrics))requireValue(['revenue','operatingProfit'].includes(k)&&Number.isSafeInteger(v),'INVALID_REPORT_METRIC');
 return {documentId:d.documentId,issuerId:d.issuerId,ticker:d.ticker,author:d.author,url:d.url,location:d.location,
 publishedDate:d.publishedDate,firstSeenAtMs:d.firstSeenAtMs,originalRead:true,fiscalPeriod:d.fiscalPeriod,
 scope:d.scope,currency:d.currency,unit:d.unit,figureStatus:d.figureStatus,metrics:structuredClone(d.metrics)};
}
export function createReportJudgment(input){
 const {judgmentId,generatedAtMs,inputCutoffMs}=input??{};
 requireValue(text(judgmentId)&&time(generatedAtMs)&&time(inputCutoffMs)&&generatedAtMs>=inputCutoffMs,'INVALID_JUDGMENT_TIME_OR_ID');
 const baseline=document(input.baseline,inputCutoffMs),current=document(input.current,inputCutoffMs);
 requireValue(baseline.documentId!==current.documentId,'DUPLICATE_DOCUMENT');
 requireValue(['issuerId','ticker','fiscalPeriod','scope','currency','unit'].every(k=>baseline[k]===current[k]),'INCOMPARABLE_REPORTS');
 requireValue(baseline.publishedDate<current.publishedDate&&baseline.figureStatus==='PRELIMINARY_ESTIMATE'&&
 current.figureStatus==='COMPANY_REPORTED','UNSUPPORTED_COMPARISON_ORDER');
 const keys=Object.keys(current.metrics).sort();
 requireValue(keys.join()===Object.keys(baseline.metrics).sort().join(),'METRIC_SCOPE_MISMATCH');
 const changes=keys.map(metric=>{
  const previous=baseline.metrics[metric],value=current.metrics[metric],delta=value-previous;
  requireValue(Number.isSafeInteger(delta),'METRIC_ARITHMETIC_OVERFLOW');
  return {metric,previous,current:value,delta,percentageChange:previous===0?null:delta/Math.abs(previous)*100};
 });
 for(const field of ['interpretation','contraryEvidence','invalidation'])requireValue(text(input.thesis?.[field]),'THESIS_FIELDS_REQUIRED');
 const body={recordVersion:1,judgmentId,generatedAtMs,inputCutoffMs,ticker:current.ticker,
  kind:'HISTORICAL_REPORT_CHANGE_EXAMPLE',comparison:'PRELIMINARY_TO_COMPANY_REPORTED_SAME_PERIOD',
  baseline,current,changes,independentIssuerCount:1,
  thesis:{interpretation:input.thesis.interpretation,contraryEvidence:input.thesis.contraryEvidence,invalidation:input.thesis.invalidation,
   status:'ANALYST_INFERENCE_NOT_COMPANY_GUIDANCE'},
  judgment:{state:'REVIEW_EVIDENCE_ONLY',target:null,horizon:null,expiry:null,probability:null,
   userAction:'NOT_RECORDED',outcome:'NOT_APPLICABLE_NOT_A_FORECAST'},
  limitations:['NOT_CURRENT_INVESTMENT_ADVICE','COMPANY_REPORTED_DOES_NOT_MEAN_AUDITED',
   'SINGLE_ISSUER_NOT_INDEPENDENT_CORROBORATION','NO_PRIVATE_PORTFOLIO_OR_AUTOMATED_ORDER']};
 const contentSha256=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 return freeze({...body,contentSha256});
}
export function appendReportJudgment(records,record){
 requireValue(Array.isArray(records),'INVALID_JUDGMENT_LOG');
 requireValue(!records.some(r=>r.judgmentId===record?.judgmentId),'JUDGMENT_ALREADY_EXISTS');
 const {contentSha256,...body}=record??{};
 requireValue(typeof contentSha256==='string'&&createHash('sha256').update(JSON.stringify(body)).digest('hex')===contentSha256,'JUDGMENT_HASH_MISMATCH');
 requireValue(records.every(r=>time(r.generatedAtMs)&&r.generatedAtMs<=record.generatedAtMs),'BACKDATED_JUDGMENT_APPEND');
 return freeze([...structuredClone(records),structuredClone(record)]);
}
