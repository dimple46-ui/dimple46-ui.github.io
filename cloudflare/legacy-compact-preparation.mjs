// Source preparation only. This module performs no I/O, authentication or deployment.
// The operator must verify the exact base module hash before using its output.
export function legacyCompactParts(relaySource) {
  const start=relaySource.indexOf('function usableHistoryMetric(');
  const end=relaySource.indexOf('async function persistMarketHistory(');
  const helperStart=relaySource.indexOf('async function persistCompactHistoryRun(');
  const helperEnd=relaySource.indexOf('function scheduleMarketHistory(',helperStart);
  if(start<0||end<=start||helperStart<end||helperEnd<=helperStart)
    throw new Error('COMPACT_EXTRACTION_BOUNDARY_CHANGED');
  return {coreSource:relaySource.slice(start,end),persistHelperSource:relaySource.slice(helperStart,helperEnd)};
}

// Self-contained so a metadata-only preview can run next to the provider-held source,
// returning hashes/structural checks rather than exporting the complete production module.
export function prepareLegacyCompactSource(baseSource,{coreSource,persistHelperSource}) {
  const fail=code=>{throw new Error(code);};
  if(typeof baseSource!=='string'||typeof coreSource!=='string'||typeof persistHelperSource!=='string')
    fail('SOURCE_TEXT_REQUIRED');
  const marker='__LEGACY_COMPACT_HISTORY_V2';
  if(baseSource.includes(marker)||baseSource.includes('FEATURE_COMPACT_WRITE_ENABLED'))
    fail('BASE_ALREADY_HAS_COMPACT_PATH');
  const start=baseSource.indexOf('async function persistMarketHistory(');
  const end=baseSource.indexOf('function scheduleMarketHistory(',start);
  if(start<0||end<=start||baseSource.indexOf('async function persistMarketHistory(',start+1)>=0)
    fail('LEGACY_HISTORY_BOUNDARY_CHANGED');
  const original=baseSource.slice(start,end);
  if(original.split('const features=historyFeatures(decodeHistoryRow(stored),rows.results);').length!==2)
    fail('LEGACY_FEATURE_PATH_CHANGED');
  const tail='  return {status:"STORED",slotMs:current.slot_ms};\n}\n';
  if(!original.endsWith(tail)||original.split(tail).length!==2) fail('LEGACY_RETURN_CONTRACT_CHANGED');
  if(!coreSource.startsWith('function usableHistoryMetric(')||
    !coreSource.includes('function buildCompactFeatureRun(')||
    !persistHelperSource.startsWith('async function persistCompactHistoryRun('))
    fail('COMPACT_SOURCE_CONTRACT_CHANGED');
  const isolated=`// Optional validated compact code has its own lexical scope; legacy helpers stay untouched.\n`+
    `const ${marker} = (()=>{\nconst FEATURE_VERSION=2;\nconst SAME_TIME_TOLERANCE_MS=150000;\n`+
    `const KST_OFFSET_MS=32400000;\n${coreSource}\n${persistHelperSource}\nreturn persistCompactHistoryRun;\n})();\n`;
  const replacement=`  const resultStatus={status:"STORED",slotMs:current.slot_ms};\n`+
    `  if(String(env.FEATURE_COMPACT_WRITE_ENABLED??"false")==="true") {\n`+
    `    try {resultStatus.compact=await ${marker}(env,db,stored,rows.results);}\n`+
    `    catch {resultStatus.compact={status:"FAILED",reason:"COMPACT_STORAGE_FAILED"};}\n`+
    `    console.log("Compact history",resultStatus.compact.status,resultStatus.compact.reason??null);\n`+
    `  }\n  return resultStatus;\n}\n`;
  const patched=original.slice(0,-tail.length)+replacement;
  const source=baseSource.slice(0,start)+isolated+patched+baseSource.slice(end);
  return {source,originalHistory:original,patchedHistory:patched,isolatedSource:isolated,
    unchangedPrefix:baseSource.slice(0,start),unchangedSuffix:baseSource.slice(end)};
}
