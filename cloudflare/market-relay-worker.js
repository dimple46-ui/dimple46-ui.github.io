const SOURCE_URL = "https://live.dimple3691.workers.dev/market";
const TARGET_PATH = "market-live.json";
const BRANCH = "main";
const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";

const ESTIMATE_SLOTS = [
  { hour: 9, minute: 30, key: "0930" },
  { hour: 10, minute: 0, key: "1000" },
  { hour: 11, minute: 20, key: "1120" },
  { hour: 13, minute: 20, key: "1320" },
  { hour: 14, minute: 30, key: "1430" }
];

const QUALITY_VERSION = "2026-10-01.1";
const memoryCache = new Map();

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function parseRepo(fullName) {
  const [owner, repo] = String(fullName || "").split("/");
  if (!owner || !repo) throw new Error("Invalid REPO_FULL_NAME");
  return { owner, repo };
}

function kstParts(epochMs = Date.now()) {
  const d = new Date(epochMs + 9 * 60 * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds()
  };
}

function kstYmd(epochMs = Date.now()) {
  const p = kstParts(epochMs);
  return `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
}

function kstIsoFromYmdHms(ymd, hms = "000000") {
  const s = String(ymd || "");
  if (!/^\d{8}$/.test(s)) return null;
  const t = String(hms || "").replaceAll(":", "").padEnd(6, "0").slice(0, 6);
  if (!/^\d{6}$/.test(t) || Number(t.slice(0,2)) > 23 || Number(t.slice(2,4)) > 59 || Number(t.slice(4,6)) > 59) return null;
  const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}+09:00`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || kstYmd(ms) !== s) return null;
  return new Date(ms).toISOString();
}

function ageSeconds(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.round((nowMs - ms) / 1000);
}

function metaRecord({
  source,
  marketTime = null,
  fetchedAt = null,
  status = "UNKNOWN",
  timeBasis = null,
  maxAgeSeconds = null
}, nowMs = Date.now()) {
  return {
    source,
    marketTime,
    fetchedAt,
    sourceAgeSeconds: ageSeconds(marketTime || fetchedAt, nowMs),
    status,
    timeBasis,
    maxAgeSeconds
  };
}

function continuousStatus(value, marketTime, maxAgeSeconds, nowMs = Date.now()) {
  if (!value) return "MISSING";
  const age = ageSeconds(marketTime, nowMs);
  if (age == null) return "UNKNOWN";
  if (age < -60) return "INVALID_TIME";
  if (["CLOSE", "CLOSED"].includes(String(value.marketStatus || "").toUpperCase())) return "CLOSED";
  return age <= maxAgeSeconds ? "LIVE" : "STALE";
}

function stockFlowMeta(value, koreaDate, fetchedAt, nowMs = Date.now()) {
  if (!value?.latest) {
    return metaRecord({
      source: "KIS_OPEN_API",
      fetchedAt,
      status: estimateSlot(nowMs) ? "MISSING" : "NOT_DUE",
      timeBasis: "SOURCE_SCHEDULED_BUCKET"
    }, nowMs);
  }
  const inputTime = value.latest.inputTimeKst || null;
  const fetchedMs = Date.parse(value.fetchedAt);
  const businessDate = value.businessDate || (Number.isFinite(fetchedMs) ? kstYmd(fetchedMs) : null);
  const marketTime = inputTime && businessDate ? kstIsoFromYmdHms(businessDate, inputTime) : null;
  const expected = estimateSlot(nowMs);
  const latestKey = inputTime ? inputTime.replace(":", "") : null;
  let status = "CURRENT_BUCKET";
  if (businessDate && String(businessDate) !== kstYmd(nowMs)) status = "HISTORICAL";
  else if (!marketTime || ageSeconds(marketTime, nowMs) < -60) status = "INVALID_TIME";
  else if (!expected) status = "NOT_DUE";
  else if (latestKey !== expected.key) status = "STALE_BUCKET";
  return metaRecord({
    source: "KIS_OPEN_API",
    marketTime,
    fetchedAt: value.fetchedAt || fetchedAt,
    status,
    timeBasis: "SOURCE_SCHEDULED_BUCKET",
    maxAgeSeconds: null
  }, nowMs);
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

function firstValue(objects, key) {
  for (const obj of objects) {
    if (obj && obj[key] != null && obj[key] !== "") return obj[key];
  }
  return null;
}

async function cacheGet(env, key) {
  try {
    if (env.KIS_CACHE) {
      const raw = await env.KIS_CACHE.get(key);
      return raw ? JSON.parse(raw) : null;
    }
  } catch (e) {
    console.warn("KV get failed", key, e);
  }
  return memoryCache.get(key) ?? null;
}

async function cachePut(env, key, value, ttlSeconds = 86400) {
  memoryCache.set(key, value);
  if (!env.KIS_CACHE) return;
  try {
    await env.KIS_CACHE.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(60, Math.floor(ttlSeconds))
    });
  } catch (e) {
    console.warn("KV put failed", key, e);
  }
}

async function githubRequest(env, path, init = {}) {
  return fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "kr-market-relay",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

async function fetchLiveMarket(env) {
  const url = `https://live.internal/market?t=${Date.now()}`;
  const init = {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    }
  };

  let res;
  if (env.LIVE_SOURCE) {
    res = await env.LIVE_SOURCE.fetch(new Request(url, init));
  } else {
    res = await fetch(`${SOURCE_URL}?t=${Date.now()}`, {
      ...init,
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  }

  if (!res.ok) throw new Error(`Live source HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.fetchedAt) throw new Error("Live source missing fetchedAt");

  const sourceMs = Date.parse(data.fetchedAt);
  if (!Number.isFinite(sourceMs)) throw new Error("Invalid fetchedAt");
  const ageMs = Date.now() - sourceMs;

  if (ageMs < -60_000 || ageMs > 180_000) {
    throw new Error(`Stale live data: ${Math.round(ageMs / 1000)} seconds old`);
  }
  return { data, ageMs };
}

function kisEnabled(env) {
  return Boolean(env.KIS_APP_KEY && env.KIS_APP_SECRET);
}

async function getKisToken(env) {
  const cached = await cacheGet(env, "kis:access-token:v1");
  if (cached?.token && cached?.expiresAt && Date.now() < cached.expiresAt - 300_000) {
    return cached.token;
  }

  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET
    })
  });
  const text = await res.text();
  if (!res.ok) throw kisHttpError("token", res.status);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error("KIS token returned invalid JSON"); }
  if (!body.access_token) throw new Error("KIS token missing access_token");

  const expiresIn = Math.max(600, Number(body.expires_in || 86400));
  const value = {
    token: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  await cachePut(env, "kis:access-token:v1", value, Math.max(600, expiresIn - 120));
  return value.token;
}

function kisHttpError(operation, status) {
  const error = new Error(`KIS ${operation} HTTP ${status}`);
  error.category = status === 429 ? "API_LIMIT" : "SOURCE_ERROR";
  return error;
}

async function kisGet(env, token, path, trId, params) {
  const url = new URL(KIS_BASE_URL + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: "P"
    }
  });
  const text = await res.text();
  if (!res.ok) throw kisHttpError(trId, res.status);
  const body = JSON.parse(text);
  if (body.rt_cd != null && String(body.rt_cd) !== "0") {
    throw new Error(`KIS ${trId} ${body.rt_cd}: ${body.msg1 || body.msg_cd || "unknown error"}`);
  }
  return body;
}

function estimateSlot(epochMs = Date.now()) {
  const p = kstParts(epochMs);
  if (p.weekday === 0 || p.weekday === 6) return null;
  const nowMin = p.hour * 60 + p.minute;
  let latest = null;
  for (const slot of ESTIMATE_SLOTS) {
    const slotMin = slot.hour * 60 + slot.minute + 5;
    if (nowMin >= slotMin) latest = slot;
  }
  return latest;
}

function compactEstimateRows(body) {
  const bucketTimes = {
    "1": "09:30",
    "2": "10:00",
    "3": "11:20",
    "4": "13:20",
    "5": "14:30"
  };
  const raw = Array.isArray(body?.output2) ? body.output2 : body?.output2 ? [body.output2] : [];
  const rows = raw.map(row => ({
    bucket: row.bsop_hour_gb ?? null,
    inputTimeKst: bucketTimes[String(row.bsop_hour_gb ?? "")] ?? null,
    foreignNetBuyQty: num(row.frgn_fake_ntby_qty),
    institutionNetBuyQty: num(row.orgn_fake_ntby_qty),
    combinedNetBuyQty: num(row.sum_fake_ntby_qty)
  })).sort((a, b) => num(a.bucket) - num(b.bucket));
  const usable = rows.filter(r => r.foreignNetBuyQty != null || r.institutionNetBuyQty != null || r.combinedNetBuyQty != null);
  const latest = usable.length ? usable[usable.length - 1] : null;
  return { rows, latest };
}

async function getStockFlowEstimate(env, token, code, epochMs = Date.now()) {
  const slot = estimateSlot(epochMs);
  if (!slot) return null;
  const ymd = kstYmd(epochMs);
  const key = `kis:stock-flow:${ymd}:${code}:${slot.key}`;
  const cached = await cacheGet(env, key);
  if (cached?.latest?.inputTimeKst?.replace(":", "") === slot.key) return cached;

  const body = await kisGet(
    env,
    token,
    "/uapi/domestic-stock/v1/quotations/investor-trend-estimate",
    "HHPTJ04160200",
    { MKSC_SHRN_ISCD: code }
  );
  const compact = compactEstimateRows(body);
  const value = {
    source: "KIS_OPEN_API",
    isEstimate: true,
    stockCode: code,
    businessDate: ymd,
    scheduledBucket: slot.key,
    fetchedAt: new Date().toISOString(),
    latest: compact.latest,
    rows: compact.rows
  };
  // Retry delayed or empty buckets on the next relay run.
  if (compact.latest?.inputTimeKst?.replace(":", "") === slot.key) {
    await cachePut(env, key, value, 36 * 3600);
  }
  return value;
}


async function getKoreaMarketCalendar(env, token, epochMs = Date.now()) {
  const ymd = kstYmd(epochMs);
  const key = `kis:calendar:${ymd}`;
  const cached = await cacheGet(env, key);
  if (cached) return cached;

  const body = await kisGet(
    env,
    token,
    "/uapi/domestic-stock/v1/quotations/chk-holiday",
    "CTCA0903R",
    { BASS_DT: ymd, CTX_AREA_FK: "", CTX_AREA_NK: "" }
  );
  const rows = Array.isArray(body?.output) ? body.output : body?.output ? [body.output] : [];
  const row = rows.find(x => String(x?.bass_dt || "") === ymd) || null;
  if (!row) throw new Error("KIS holiday calendar missing requested date");

  const value = {
    source: "KIS_OPEN_API",
    date: row.bass_dt ?? ymd,
    weekdayCode: row.wday_dvsn_cd ?? null,
    businessDay: row.bzdy_yn ?? null,
    tradingDay: row.tr_day_yn ?? null,
    openDay: row.opnd_yn ?? null,
    settlementDay: row.sttl_day_yn ?? null,
    fetchedAt: new Date().toISOString()
  };
  // Official KIS guidance recommends avoiding frequent calls; cache for the day.
  await cachePut(env, key, value, 36 * 3600);
  return value;
}

function isFuturesRegularSession(epochMs = Date.now()) {
  const p = kstParts(epochMs);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const m = p.hour * 60 + p.minute;
  return m >= 8 * 60 + 45 && m <= 15 * 60 + 45;
}

function secondThursdayDay(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  const firstThursday = 1 + ((4 - firstDow + 7) % 7);
  return firstThursday + 7;
}

function deriveKospi200FrontMonthCode(epochMs = Date.now()) {
  const p = kstParts(epochMs);
  let year = p.year;
  let month = null;

  for (const q of [3, 6, 9, 12]) {
    if (q > p.month) {
      month = q;
      break;
    }
    if (q === p.month) {
      const expiryDay = secondThursdayDay(year, q);
      const afterExpiry =
        p.day > expiryDay ||
        (p.day === expiryDay && (p.hour > 15 || (p.hour === 15 && p.minute > 45)));
      if (!afterExpiry) {
        month = q;
        break;
      }
    }
  }

  if (month == null) {
    year += 1;
    month = 3;
  }

  return `A${String(year - 2010).padStart(3, "0")}${String(month).padStart(2, "0")}`;
}

async function resolveKospi200FuturesCode(env, token, epochMs = Date.now()) {
  if (env.KOSPI200_FUTURES_CODE) return String(env.KOSPI200_FUTURES_CODE).trim();

  const ymd = kstYmd(epochMs);
  const key = `kis:k200-futures-code:${ymd}`;
  const cached = await cacheGet(env, key);
  if (cached?.code) return cached.code;

  try {
    const body = await kisGet(
      env,
      token,
      "/uapi/domestic-futureoption/v1/quotations/display-board-futures",
      "FHPIF05030200",
      {
        FID_COND_MRKT_DIV_CODE: "F",
        FID_COND_SCR_DIV_CODE: "20503",
        FID_COND_MRKT_CLS_CODE: ""
      }
    );

    const blocks = [body?.output, body?.output1, body?.output2, body?.output3];
    const rows = blocks.flatMap(v => Array.isArray(v) ? v : v ? [v] : []);

    let candidates = rows.filter(r => {
      const name = String(r?.hts_kor_isnm || "");
      const code = String(r?.futs_shrn_iscd || "").trim();
      return code && (/KOSPI\s*200|코스피\s*200|^F\s*20/i.test(name));
    });

    if (!candidates.length) {
      candidates = rows.filter(r => String(r?.futs_shrn_iscd || "").trim() !== "");
    }

    candidates.sort((a, b) => {
      const da = num(a.hts_rmnn_dynu);
      const db = num(b.hts_rmnn_dynu);
      return (da ?? 99999) - (db ?? 99999);
    });

    const row = candidates[0];
    if (row?.futs_shrn_iscd) {
      const value = {
        code: String(row.futs_shrn_iscd).trim(),
        name: row.hts_kor_isnm ?? null,
        remainingDays: num(row.hts_rmnn_dynu),
        resolvedAt: new Date().toISOString(),
        resolution: "KIS_DISPLAY_BOARD"
      };
      await cachePut(env, key, value, 36 * 3600);
      return value.code;
    }
  } catch (e) {
    console.warn("KIS futures board resolver failed; using calendar fallback", String(e));
  }

  // KOSPI200 futures short-code scheme currently used by KIS:
  // A + (year-2010, 3 digits) + expiry month. Example: 2026-12 => A01612.
  // Expiry is the second Thursday of the quarterly month.
  const fallbackCode = deriveKospi200FrontMonthCode(epochMs);
  await cachePut(env, key, {
    code: fallbackCode,
    resolvedAt: new Date().toISOString(),
    resolution: "CALENDAR_FALLBACK"
  }, 36 * 3600);
  return fallbackCode;
}

function compactFuturesQuote(body, code, fetchedAt) {
  const objects = [body?.output1, body?.output2, body?.output3].filter(Boolean);
  const underlying =
    objects.find(x => String(x?.bstp_cls_code ?? "") === "2001") ??
    objects.find(x => /KOSPI\s*200|코스피\s*200/i.test(String(x?.hts_kor_isnm ?? ""))) ??
    null;
  return {
    source: "KIS_OPEN_API",
    code,
    name: firstValue(objects, "hts_kor_isnm"),
    marketStatus: "OPEN",
    fetchedAt,
    price: num(firstValue(objects, "futs_prpr")),
    previousClose: num(firstValue(objects, "futs_prdy_clpr")),
    change: num(firstValue(objects, "futs_prdy_vrss")),
    changeRate: num(firstValue(objects, "futs_prdy_ctrt")),
    open: num(firstValue(objects, "futs_oprc")),
    high: num(firstValue(objects, "futs_hgpr")),
    low: num(firstValue(objects, "futs_lwpr")),
    volume: num(firstValue(objects, "acml_vol")),
    tradingValue: num(firstValue(objects, "acml_tr_pbmn")),
    openInterest: num(firstValue(objects, "hts_otst_stpl_qty")),
    openInterestChange: num(firstValue(objects, "otst_stpl_qty_icdc")),
    basis: num(firstValue(objects, "basis")),
    marketBasis: num(firstValue(objects, "mrkt_basis")),
    theoreticalPrice: num(firstValue(objects, "hts_thpr")),
    disparityRate: num(firstValue(objects, "dprt")),
    lastTradingDate: firstValue(objects, "futs_last_tr_date"),
    remainingDays: num(firstValue(objects, "hts_rmnn_dynu")),
    underlyingIndex: num(underlying?.bstp_nmix_prpr),
  };
}

async function getKospi200Futures(env, token, epochMs = Date.now()) {
  const ymd = kstYmd(epochMs);
  const lastKey = `kis:k200-futures-last:${ymd}`;
  if (!isFuturesRegularSession(epochMs)) {
    const cached = await cacheGet(env, lastKey);
    return cached ? { ...cached, marketStatus: "CLOSED" } : null;
  }

  const code = await resolveKospi200FuturesCode(env, token, epochMs);
  const body = await kisGet(
    env,
    token,
    "/uapi/domestic-futureoption/v1/quotations/inquire-price",
    "FHMIF10000000",
    { FID_COND_MRKT_DIV_CODE: "F", FID_INPUT_ISCD: code }
  );
  const fetchedAt = new Date().toISOString();
  const value = compactFuturesQuote(body, code, fetchedAt);
  await cachePut(env, lastKey, value, 36 * 3600);
  return value;
}

function compactFuturesInvestor(body, fetchedAt) {
  const rows = Array.isArray(body?.output) ? body.output : body?.output ? [body.output] : [];
  if (!rows.length) return null;
  const row = rows[0];
  return {
    source: "KIS_OPEN_API",
    market: "KOSPI200_FUTURES",
    fetchedAt,
    foreign: {
      sellVolume: num(row.frgn_seln_vol),
      buyVolume: num(row.frgn_shnu_vol),
      netBuyQty: num(row.frgn_ntby_qty),
      sellAmount: num(row.frgn_seln_tr_pbmn),
      buyAmount: num(row.frgn_shnu_tr_pbmn),
      netBuyAmount: num(row.frgn_ntby_tr_pbmn)
    },
    individual: {
      sellVolume: num(row.prsn_seln_vol),
      buyVolume: num(row.prsn_shnu_vol),
      netBuyQty: num(row.prsn_ntby_qty),
      sellAmount: num(row.prsn_seln_tr_pbmn),
      buyAmount: num(row.prsn_shnu_tr_pbmn),
      netBuyAmount: num(row.prsn_ntby_tr_pbmn)
    },
    institution: {
      sellVolume: num(row.orgn_seln_vol),
      buyVolume: num(row.orgn_shnu_vol),
      netBuyQty: num(row.orgn_ntby_qty),
      sellAmount: num(row.orgn_seln_tr_pbmn),
      buyAmount: num(row.orgn_shnu_tr_pbmn),
      netBuyAmount: num(row.orgn_ntby_tr_pbmn)
    },
    detail: {
      securitiesNetBuyQty: num(row.scrt_ntby_qty),
      investmentTrustNetBuyQty: num(row.ivtr_ntby_qty),
      privateFundNetBuyQty: num(row.pe_fund_ntby_vol),
      bankNetBuyQty: num(row.bank_ntby_qty),
      insuranceNetBuyQty: num(row.insu_ntby_qty),
      merchantBankNetBuyQty: num(row.mrbn_ntby_qty),
      fundNetBuyQty: num(row.fund_ntby_qty),
      otherOrganizationNetBuyQty: num(row.etc_orgt_ntby_vol),
      otherCorporationNetBuyQty: num(row.etc_corp_ntby_vol)
    }
  };
}

async function getKospi200FuturesInvestors(env, token, epochMs = Date.now()) {
  const ymd = kstYmd(epochMs);
  const key = `kis:k200-futures-investors-last:${ymd}`;
  if (!isFuturesRegularSession(epochMs)) {
    const cached = await cacheGet(env, key);
    return cached ? { ...cached, marketStatus: "CLOSED" } : null;
  }

  const body = await kisGet(
    env,
    token,
    "/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market",
    "FHPTJ04030000",
    { FID_INPUT_ISCD: "K2I", FID_INPUT_ISCD_2: "F001" }
  );
  const value = compactFuturesInvestor(body, new Date().toISOString());
  if (value) await cachePut(env, key, { ...value, marketStatus: "OPEN" }, 36 * 3600);
  return value ? { ...value, marketStatus: "OPEN" } : null;
}

async function enrichWithKis(env, epochMs = Date.now()) {
  if (!kisEnabled(env)) return { enabled: false, data: {}, errors: [] };

  const errors = [];
  let token;
  try {
    token = await getKisToken(env);
  } catch (e) {
    return { enabled: true, data: {}, errors: [{ source: "KIS_TOKEN", category: e?.category || "SOURCE_ERROR", message: String(e) }] };
  }

  let calendar = null;
  try {
    calendar = await getKoreaMarketCalendar(env, token, epochMs);
  } catch (error) {
    errors.push({ source: "calendar.korea", category: error?.category || "SOURCE_ERROR", message: String(error) });
  }
  if (koreaCalendarStatus(calendar, epochMs) === "HOLIDAY") {
    return { enabled: true, data: { calendar: { korea: calendar } }, errors };
  }
  const tasks = [
    ["stockFlowEstimates.samsung", () => getStockFlowEstimate(env, token, "005930", epochMs)],
    ["stockFlowEstimates.skHynix", () => getStockFlowEstimate(env, token, "000660", epochMs)],
    ["futures.kospi200", () => getKospi200Futures(env, token, epochMs)],
    ["futuresInvestors.kospi200", () => getKospi200FuturesInvestors(env, token, epochMs)]
  ];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  const data = { calendar: { korea: calendar }, stockFlowEstimates: {}, futures: {}, futuresInvestors: {} };
  settled.forEach((r, i) => {
    const key = tasks[i][0];
    if (r.status === "rejected") {
      errors.push({ source: key, category: r.reason?.category || "SOURCE_ERROR", message: String(r.reason) });
      return;
    }
    const [group, field] = key.split(".");
    data[group][field] = r.value;
  });
  return { enabled: true, data, errors };
}

function compactStock(stock) {
  if (!stock) return null;
  const price = num(stock.price);
  const previousClose = num(stock.previousClose);
  const signedChange = price != null && previousClose != null ? price - previousClose : null;
  const signedChangeRate = signedChange != null && previousClose
    ? Math.round((signedChange / previousClose) * 10000) / 100
    : null;
  return {
    code: stock.code ?? null,
    name: stock.name ?? null,
    marketStatus: stock.marketStatus ?? null,
    previousClose: stock.previousClose ?? null,
    price: stock.price ?? null,
    change: stock.change ?? null,
    changeRate: stock.changeRate ?? null,
    signedChange,
    signedChangeRate,
    open: stock.open ?? null,
    high: stock.high ?? null,
    low: stock.low ?? null,
    volume: stock.volume ?? null,
    tradingValue: stock.tradingValue ?? null,
    nxtPrice: stock.nxtPrice ?? null,
    nxtChangeRate: stock.nxtChangeRate ?? null,
    lastTradedAt: stock.lastTradedAt ?? null
  };
}

function compactIndex(index) {
  if (!index) return null;
  const scale = 100;
  const scaled = v => {
    const n = num(v);
    return n == null ? null : n / scale;
  };
  return {
    code: index.code ?? null,
    marketStatus: index.marketStatus ?? null,
    value: index.value ?? null,
    change: index.change ?? null,
    changeRate: index.changeRate ?? null,
    open: index.open ?? null,
    high: index.high ?? null,
    low: index.low ?? null,
    volume: index.volume ?? null,
    tradingValue: index.tradingValue ?? null,
    rawScale: scale,
    normalizedValue: scaled(index.value),
    normalizedChange: scaled(index.change),
    normalizedOpen: scaled(index.open),
    normalizedHigh: scaled(index.high),
    normalizedLow: scaled(index.low)
  };
}

function latestConfirmedFlow(history) {
  const item = history?.result?.items?.[0];
  if (!item) return null;
  return {
    date: item.localTradedAt ?? null,
    foreignHoldingRatio: item.foreignHoldingRatio ?? null,
    closingPrice: item.krx?.closingPrice != null ? Number(item.krx.closingPrice) : null,
    foreignNetVolume: item.krx?.foreignNetVolume != null ? Number(item.krx.foreignNetVolume) : null,
    organizationNetVolume: item.krx?.organizationNetVolume != null ? Number(item.krx.organizationNetVolume) : null,
    individualNetVolume: item.krx?.individualNetVolume != null ? Number(item.krx.individualNetVolume) : null,
    tradingVolume: item.krx?.tradingVolume != null ? Number(item.krx.tradingVolume) : null
  };
}


function buildDataMeta(payload, data, kis, nowMs = Date.now()) {
  const sourceFetchedAt = data.fetchedAt ?? null;
  const samsung = payload.stocks?.samsung ?? null;
  const hynix = payload.stocks?.skHynix ?? null;
  const kospi = payload.indexes?.kospi ?? null;
  const k200 = payload.indexes?.kospi200 ?? null;
  const inv = payload.kospiInvestors;
  const prog = payload.program;
  const fut = payload.futures?.kospi200 ?? null;
  const futInv = payload.futuresInvestors?.kospi200 ?? null;
  const cal = kis.data?.calendar?.korea ?? null;

  const investorTime = inv?.bizdate && inv?.time ? kstIsoFromYmdHms(inv.bizdate, inv.time) : null;
  const programTime = prog?.bizdate && prog?.time ? kstIsoFromYmdHms(prog.bizdate, prog.time) : null;

  const calendarStatus = koreaCalendarStatus(cal, nowMs);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    session: {
      source: cal?.source ?? "KIS_OPEN_API",
      marketTime: cal?.date ? kstIsoFromYmdHms(cal.date, "000000") : null,
      fetchedAt: cal?.fetchedAt ?? null,
      sourceAgeSeconds: ageSeconds(cal?.fetchedAt ?? null, nowMs),
      status: calendarStatus,
      openDay: cal?.openDay ?? null,
      tradingDay: cal?.tradingDay ?? null,
      businessDay: cal?.businessDay ?? null
    },
    stocks: {
      samsung: metaRecord({
        source: "NAVER_NPAY",
        marketTime: samsung?.lastTradedAt ?? null,
        fetchedAt: sourceFetchedAt,
        status: continuousStatus(samsung, samsung?.lastTradedAt, 300, nowMs),
        timeBasis: "SOURCE_TRADE_TIME",
        maxAgeSeconds: 300
      }, nowMs),
      skHynix: metaRecord({
        source: "NAVER_NPAY",
        marketTime: hynix?.lastTradedAt ?? null,
        fetchedAt: sourceFetchedAt,
        status: continuousStatus(hynix, hynix?.lastTradedAt, 300, nowMs),
        timeBasis: "SOURCE_TRADE_TIME",
        maxAgeSeconds: 300
      }, nowMs)
    },
    indexes: {
      kospi: metaRecord({
        source: "NAVER_NPAY",
        marketTime: sourceFetchedAt,
        fetchedAt: sourceFetchedAt,
        status: continuousStatus(kospi, sourceFetchedAt, 300, nowMs),
        timeBasis: "FETCH_TIME_NO_EXCHANGE_TIMESTAMP",
        maxAgeSeconds: 300
      }, nowMs),
      kospi200: metaRecord({
        source: "NAVER_NPAY",
        marketTime: sourceFetchedAt,
        fetchedAt: sourceFetchedAt,
        status: continuousStatus(k200, sourceFetchedAt, 300, nowMs),
        timeBasis: "FETCH_TIME_NO_EXCHANGE_TIMESTAMP",
        maxAgeSeconds: 300
      }, nowMs)
    },
    kospiInvestors: metaRecord({
      source: "NAVER_NPAY",
      marketTime: investorTime,
      fetchedAt: sourceFetchedAt,
      status: continuousStatus(inv, investorTime, 300, nowMs),
      timeBasis: "SOURCE_MARKET_TIME",
      maxAgeSeconds: 300
    }, nowMs),
    program: metaRecord({
      source: "NAVER_NPAY",
      marketTime: programTime,
      fetchedAt: sourceFetchedAt,
      status: continuousStatus(prog, programTime, 300, nowMs),
      timeBasis: "SOURCE_MARKET_TIME",
      maxAgeSeconds: 300
    }, nowMs),
    stockFlowEstimates: {
      samsung: stockFlowMeta(payload.stockFlowEstimates?.samsung, payload.koreaDate, sourceFetchedAt, nowMs),
      skHynix: stockFlowMeta(payload.stockFlowEstimates?.skHynix, payload.koreaDate, sourceFetchedAt, nowMs)
    },
    futures: {
      kospi200: metaRecord({
        source: "KIS_OPEN_API",
        marketTime: fut?.fetchedAt ?? null,
        fetchedAt: fut?.fetchedAt ?? null,
        status: continuousStatus(fut, fut?.fetchedAt, 300, nowMs),
        timeBasis: "FETCH_TIME_NO_EXCHANGE_TIMESTAMP",
        maxAgeSeconds: 300
      }, nowMs)
    },
    futuresInvestors: {
      kospi200: metaRecord({
        source: "KIS_OPEN_API",
        marketTime: futInv?.fetchedAt ?? null,
        fetchedAt: futInv?.fetchedAt ?? null,
        status: continuousStatus(futInv, futInv?.fetchedAt, 300, nowMs),
        timeBasis: "FETCH_TIME_NO_EXCHANGE_TIMESTAMP",
        maxAgeSeconds: 300
      }, nowMs)
    },
    lastConfirmedStockFlow: {
      samsung: metaRecord({
        source: "NAVER_NPAY",
        marketTime: payload.lastConfirmedStockFlow?.samsung?.date
          ? kstIsoFromYmdHms(String(payload.lastConfirmedStockFlow.samsung.date).replaceAll("-", ""), "153000")
          : null,
        fetchedAt: sourceFetchedAt,
        status: payload.lastConfirmedStockFlow?.samsung ? "DAILY_CONFIRMED" : "MISSING",
        timeBasis: "DAILY_CONFIRMED_CLOSE"
      }, nowMs),
      skHynix: metaRecord({
        source: "NAVER_NPAY",
        marketTime: payload.lastConfirmedStockFlow?.skHynix?.date
          ? kstIsoFromYmdHms(String(payload.lastConfirmedStockFlow.skHynix.date).replaceAll("-", ""), "153000")
          : null,
        fetchedAt: sourceFetchedAt,
        status: payload.lastConfirmedStockFlow?.skHynix ? "DAILY_CONFIRMED" : "MISSING",
        timeBasis: "DAILY_CONFIRMED_CLOSE"
      }, nowMs)
    }
  };
}

// Fetch freshness and market freshness are different. Unknown exchange times
// must remain null; callers can inspect fetchedAt without treating it as a trade.
function koreaCalendarStatus(calendar, nowMs) {
  if (!calendar || String(calendar.date) !== kstYmd(nowMs)) return "UNKNOWN";
  const flag = String(calendar.openDay || "").toUpperCase();
  return flag === "Y" ? "TRADING_DAY" : flag === "N" ? "HOLIDAY" : "UNKNOWN";
}

function applyDataQuality(payload, kis, nowMs) {
  const meta = payload.dataMeta;
  const calendarStatus = meta.session.status;
  const closed = v => ["CLOSE", "CLOSED"].includes(String(v?.marketStatus || "").toUpperCase());
  const records = [
    ["stocks.samsung", meta.stocks.samsung, payload.stocks.samsung, "price"],
    ["stocks.skHynix", meta.stocks.skHynix, payload.stocks.skHynix, "price"],
    ["indexes.kospi", meta.indexes.kospi, payload.indexes.kospi, "value"],
    ["indexes.kospi200", meta.indexes.kospi200, payload.indexes.kospi200, "value"],
    ["kospiInvestors", meta.kospiInvestors, payload.kospiInvestors, "summary"],
    ["program", meta.program, payload.program, "totalNet"],
    ["stockFlowEstimates.samsung", meta.stockFlowEstimates.samsung, payload.stockFlowEstimates.samsung, "latest"],
    ["stockFlowEstimates.skHynix", meta.stockFlowEstimates.skHynix, payload.stockFlowEstimates.skHynix, "latest"],
    ["futures.kospi200", meta.futures.kospi200, payload.futures.kospi200, "price"],
    ["futuresInvestors.kospi200", meta.futuresInvestors.kospi200, payload.futuresInvestors.kospi200, "foreign"],
  ];
  const issues = [];
  for (const [path, record, value, required] of records) {
    record.marketAgeSeconds = ageSeconds(record.marketTime, nowMs);
    record.fetchAgeSeconds = ageSeconds(record.fetchedAt, nowMs);
    record.hasValue = value?.[required] != null;
    if (!record.hasValue && record.status !== "NOT_DUE") record.status = "MISSING";
    if (record.timeBasis === "FETCH_TIME_NO_EXCHANGE_TIMESTAMP") {
      record.marketTime = null;
      record.marketAgeSeconds = null;
      record.sourceAgeSeconds = null;
      if (record.status === "LIVE") record.status = "RECENT_FETCH";
    }
    // Source-close evidence takes precedence over elapsed wall-clock age.
    if (["kospiInvestors", "program"].includes(path) && record.hasValue &&
        closed(payload.indexes.kospi) && !["UNKNOWN", "INVALID_TIME"].includes(record.status)) {
      record.status = "CLOSED";
    }
    if (calendarStatus === "HOLIDAY" && record.status !== "INVALID_TIME") record.status = "HOLIDAY";
    if (record.source === "KIS_OPEN_API" && !kis.enabled) record.status = "DISABLED";
    const errors = payload.sourceErrors.filter(error => error?.source === path ||
      (record.source === "KIS_OPEN_API" && error?.source === "KIS_TOKEN"));
    if (errors.length) {
      // Only explicit HTTP rate limits are classified here.
      record.status = errors.some(error => error.category === "API_LIMIT") ? "API_LIMIT" : "SOURCE_ERROR";
      record.errorSources = errors.map(error => error.source);
    }
    if (["MISSING", "UNKNOWN", "STALE", "STALE_BUCKET", "HISTORICAL", "INVALID_TIME", "SOURCE_ERROR", "API_LIMIT", "DISABLED"].includes(record.status)) {
      issues.push({ path, status: record.status });
    }
  }
  if (calendarStatus === "UNKNOWN") issues.push({ path: "calendar.korea", status: "UNKNOWN" });
  const sourceAge = ageSeconds(payload.sourceFetchedAt, nowMs);
  payload.sourceAgeSeconds = sourceAge;
  payload.fresh = sourceAge != null && sourceAge >= -60 && sourceAge <= 180;
  if (!payload.fresh) issues.push({ path: "sourceFetchedAt", status: "INVALID_OR_STALE" });
  payload.qualityVersion = QUALITY_VERSION;
  payload.dataQuality = {
    evaluatedAt: new Date(nowMs).toISOString(),
    issues,
    unverifiedMarketTimes: records.filter(([, r]) => r.timeBasis === "FETCH_TIME_NO_EXCHANGE_TIMESTAMP").map(([path]) => path),
    freshnessScope: "INGESTION_ONLY_RECOMPUTE_AT_READ_TIME"
  };
  payload.pipelineStatus = payload.sourceErrors.length || issues.length
    ? "DEGRADED" : calendarStatus === "HOLIDAY" ? "HOLIDAY" : "OK";
}

function buildPayload(data, ageMs, kis, nowMs = Date.now()) {
  const indexes = Array.isArray(data.indexes) ? data.indexes : [];
  const sourceErrors = Array.isArray(data.errors) ? data.errors : [];
  const payload = {
    schemaVersion: 3,
    fresh: true,
    relayUpdatedAt: new Date(nowMs).toISOString(),
    sourceFetchedAt: data.fetchedAt,
    sourceAgeSeconds: Math.round(ageMs / 1000),
    koreaDate: data.koreaDate ?? kstYmd(nowMs),
    stocks: {
      samsung: compactStock(data.stocks?.samsung),
      skHynix: compactStock(data.stocks?.skHynix)
    },
    indexes: {
      kospi: compactIndex(indexes.find(x => x.code === "KOSPI")),
      kospi200: compactIndex(indexes.find(x => x.code === "KPI200"))
    },
    kospiInvestors: data.kospiInvestors ? {
      bizdate: data.kospiInvestors.bizdate ?? null,
      time: data.kospiInvestors.time ?? null,
      summary: data.kospiInvestors.summary ?? null,
      detail: data.kospiInvestors.detail ?? null
    } : null,
    program: data.program ? {
      bizdate: data.program.bizdate ?? null,
      time: data.program.time ?? null,
      arbitrageNet: data.program.arbitrageNet ?? null,
      nonArbitrageNet: data.program.nonArbitrageNet ?? null,
      totalNet: data.program.totalNet ?? null
    } : null,
    stockFlowEstimates: {
      samsung: kis.data?.stockFlowEstimates?.samsung ?? null,
      skHynix: kis.data?.stockFlowEstimates?.skHynix ?? null
    },
    futures: { kospi200: kis.data?.futures?.kospi200 ?? null },
    futuresInvestors: { kospi200: kis.data?.futuresInvestors?.kospi200 ?? null },
    lastConfirmedStockFlow: {
      samsung: latestConfirmedFlow(data.stockInvestorHistory?.samsung),
      skHynix: latestConfirmedFlow(data.stockInvestorHistory?.skHynix)
    },
    integrations: {
      kis: {
        enabled: kis.enabled,
        note: "stockFlowEstimates are intraday estimates; lastConfirmedStockFlow is prior confirmed daily flow"
      }
    },
    sourceErrors: [...sourceErrors, ...(kis.errors || [])]
  };
  payload.calendar = { korea: kis.data?.calendar?.korea ?? null };
  payload.dataMeta = buildDataMeta(payload, data, kis, nowMs);
  applyDataQuality(payload, kis, nowMs);
  return payload;
}
async function updateGithubFile(env, payload) {
  if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");
  if (!env.REPO_FULL_NAME) throw new Error("Missing REPO_FULL_NAME");
  const { owner, repo } = parseRepo(env.REPO_FULL_NAME);
  const encodedPath = TARGET_PATH.split("/").map(encodeURIComponent).join("/");
  const getRes = await githubRequest(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(BRANCH)}`);
  let currentSha = null;
  if (getRes.ok) currentSha = (await getRes.json()).sha ?? null;
  else if (getRes.status !== 404) throw new Error(`GitHub GET ${getRes.status}: ${(await getRes.text()).slice(0, 300)}`);

  const body = {
    message: `Update live market snapshot ${payload.sourceFetchedAt}`,
    content: utf8ToBase64(JSON.stringify(payload, null, 2)),
    branch: BRANCH
  };
  if (currentSha) body.sha = currentSha;
  const putRes = await githubRequest(env, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`, { method: "PUT", body: JSON.stringify(body) });
  if (!putRes.ok) throw new Error(`GitHub PUT ${putRes.status}: ${(await putRes.text()).slice(0, 500)}`);
  return putRes.json();
}

function isKoreaMarketRelayWindow(epochMs) {
  const p = kstParts(epochMs);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const m = p.hour * 60 + p.minute;
  return m >= 9 * 60 && m <= 20 * 60;
}

// D1 history v1: public market metrics only; never serialize env or portfolio.
const HISTORY_INTERVAL_MS = 120000;
const HISTORY_VERSION = 1;
function historyEnabled(env) {
  return Boolean(env.MARKET_HISTORY) && String(env.HISTORY_ENABLED ?? "true") !== "false";
}
function historyMetric(value, meta, availableAt) {
  return {
    value: num(value), source: meta?.source ?? null, status: meta?.status ?? "UNKNOWN",
    marketTime: meta?.marketTime ?? null,
    fetchedAt: meta?.fetchedAt ?? null,
    timeBasis: meta?.timeBasis ?? null,
    availableAt
  };
}
function historyObservation(payload) {
  const observed = Date.parse(payload.relayUpdatedAt);
  if (!Number.isFinite(observed)) throw new Error("HISTORY_INVALID_TIMESTAMP");
  const day = kstYmd(observed);
  if (day !== payload.koreaDate) throw new Error("HISTORY_DATE_MISMATCH");
  const metrics = {};
  const add = (name, value, meta) => { metrics[name] = historyMetric(value, meta, payload.relayUpdatedAt); };
  for (const name of ["samsung", "skHynix"]) {
    const stock = payload.stocks?.[name];
    for (const field of ["price", "previousClose", "open", "high", "low", "volume", "tradingValue"]) {
      add(`${name}.${field}`, stock?.[field], payload.dataMeta?.stocks?.[name]);
    }
    for (const [field, source] of [["foreignFlow", "foreignNetBuyQty"], ["institutionFlow", "institutionNetBuyQty"]]) {
      add(`${name}.${field}`, payload.stockFlowEstimates?.[name]?.latest?.[source], payload.dataMeta?.stockFlowEstimates?.[name]);
    }
  }
  for (const name of ["kospi", "kospi200"]) add(`${name}.price`, payload.indexes?.[name]?.normalizedValue, payload.dataMeta?.indexes?.[name]);
  for (const name of ["foreigner", "institution", "individual"]) add(`market.${name}`, payload.kospiInvestors?.summary?.[name], payload.dataMeta?.kospiInvestors);
  for (const name of ["arbitrageNet", "nonArbitrageNet", "totalNet"]) add(`program.${name}`, payload.program?.[name], payload.dataMeta?.program);
  for (const name of ["price", "openInterest", "openInterestChange", "basis", "marketBasis"]) add(`futures.${name}`, payload.futures?.kospi200?.[name], payload.dataMeta?.futures?.kospi200);
  for (const name of ["foreign", "institution", "individual"]) add(`futures.${name}Net`, payload.futuresInvestors?.kospi200?.[name]?.netBuyQty, payload.dataMeta?.futuresInvestors?.kospi200);
  return {
    slot_ms: Math.floor(observed / HISTORY_INTERVAL_MS) * HISTORY_INTERVAL_MS,
    observed_at_ms: observed, available_at_ms: observed, trading_day: day,
    schema_version: HISTORY_VERSION, quality_version: payload.qualityVersion ?? null,
    pipeline_status: payload.pipelineStatus ?? "UNKNOWN", metrics,
    quality: { dataQuality: payload.dataQuality ?? null, sourceErrors: (payload.sourceErrors || []).map(e => ({source:e.source, category:e.category ?? "SOURCE_ERROR"})),
      futuresCode: payload.futures?.kospi200?.code ?? null }
  };
}
function usableHistoryMetric(metric, atMs) {
  if (!metric || metric.value == null || !Number.isFinite(metric.value)) return false;
  const available = Date.parse(metric.availableAt);
  if (!Number.isFinite(available) || available > atMs) return false;
  if (!["LIVE", "RECENT_FETCH", "CURRENT_BUCKET"].includes(metric.status)) return false;
  const timestamp = Date.parse(metric.marketTime || metric.fetchedAt);
  if (!Number.isFinite(timestamp) || timestamp > atMs + 60000) return false;
  return metric.status === "CURRENT_BUCKET" || atMs - timestamp <= 300000;
}
function decodeHistoryRow(row) {
  return {...row, metrics: row.metrics ?? JSON.parse(row.metrics_json), quality: row.quality ?? JSON.parse(row.quality_json)};
}
function historyFeatures(current, rawRows) {
  const now = current.observed_at_ms;
  // The as-of cutoff rejects records collected later, even if backdated.
  const rows = rawRows.map(decodeHistoryRow).filter(r => r.trading_day === current.trading_day &&
    r.observed_at_ms <= now && r.available_at_ms <= now).sort((a,b) => a.observed_at_ms-b.observed_at_ms);
  const windows = {};
  for (const minutes of [5,10,30]) {
    const target = now - minutes * 60000;
    // Use only a sample at/before target; no interpolation or future sample.
    const candidates = rows.filter(r => r.observed_at_ms <= target && target-r.observed_at_ms <= 150000);
    const baseline = candidates.at(-1);
    const window = {status: baseline ? "AVAILABLE" : "INSUFFICIENT_HISTORY", requestedMinutes:minutes,
      baselineAt:baseline ? new Date(baseline.observed_at_ms).toISOString() : null,
      actualElapsedSeconds:baseline ? (now-baseline.observed_at_ms)/1000 : null, metrics:{}};
    for (const [name, metric] of Object.entries(current.metrics)) {
      const old = baseline?.metrics?.[name];
      const result = {value:null, status:"INSUFFICIENT_HISTORY"};
      if (baseline) {
        result.status = "UNUSABLE_DATA";
        if (usableHistoryMetric(metric,now) && usableHistoryMetric(old,baseline.observed_at_ms)) {
          result.status = "OK";
          const bucket = name.endsWith("Flow");
          const isFuture = name.startsWith("futures.");
          if (isFuture && (!current.quality.futuresCode || current.quality.futuresCode !== baseline.quality.futuresCode)) {
            result.status = "CONTRACT_CHANGED";
          } else if (bucket) {
            // Bucket data is stepwise; repeated observations are not fresh zero flows.
            result.status = metric.marketTime === old.marketTime ? "UNCHANGED_BUCKET" : "BUCKET_CHANGE_ONLY";
          } else if (name.endsWith(".price")) {
            result.value = old.value > 0 ? (metric.value/old.value-1)*100 : null;
            result.status = result.value == null ? "INVALID_BASELINE" : "OK";
            result.unit = "percent";
          } else if (!/\.(previousClose|open|high|low)$/.test(name)) {
            result.value = metric.value-old.value;
            if (/\.(volume|tradingValue)$/.test(name) && result.value < 0) {
              result.value=null; result.status="COUNTER_RESET";
            }
          } else { result.status="NOT_APPLICABLE"; }
          result.timeBasis = metric.timeBasis;
        }
      }
      window.metrics[name]=result;
    }
    // Acceleration is change in shares/minute across two actual sampled windows.
    const previousTarget = baseline ? baseline.observed_at_ms-minutes*60000 : null;
    const earlier = baseline ? rows.filter(r => r.observed_at_ms<=previousTarget && previousTarget-r.observed_at_ms<=150000).at(-1) : null;
    window.volumeAcceleration = {};
    for (const name of ["samsung","skHynix"]) {
      const field=`${name}.volume`, metric=current.metrics[field], old=baseline?.metrics[field], prev=earlier?.metrics[field];
      const result={value:null,unit:"shares_per_minute_change",status:"INSUFFICIENT_HISTORY"};
      if (baseline && earlier && usableHistoryMetric(metric,now) && usableHistoryMetric(old,baseline.observed_at_ms) && usableHistoryMetric(prev,earlier.observed_at_ms)) {
        const d1=metric.value-old.value,d0=old.value-prev.value;
        if(d1>=0 && d0>=0){result.value=d1/((now-baseline.observed_at_ms)/60000)-d0/((baseline.observed_at_ms-earlier.observed_at_ms)/60000);result.status="OK";}
        else result.status="COUNTER_RESET";
      }
      window.volumeAcceleration[name]=result;
    }
    window.relativeStrength={};
    for(const [a,b] of [["samsung","skHynix"],["samsung","kospi"],["skHynix","kospi"],["samsung","kospi200"],["skHynix","kospi200"]]) {
      const av=window.metrics[`${a}.price`],bv=window.metrics[`${b}.price`];
      window.relativeStrength[`${a}_vs_${b}`]={value:av?.value!=null&&bv?.value!=null?av.value-bv.value:null,unit:"percentage_points"};
    }
    windows[`${minutes}m`]=window;
  }
  const bucketChanges={};
  for(const name of ["samsung","skHynix"]){
    bucketChanges[name]={};
    for(const field of ["foreignFlow","institutionFlow"]){
      const key=`${name}.${field}`,metric=current.metrics[key];
      const previous=rows.filter(r=>r.observed_at_ms<now && usableHistoryMetric(r.metrics[key],r.observed_at_ms) && r.metrics[key].marketTime !== metric?.marketTime).at(-1);
      bucketChanges[name][field]={value:previous && usableHistoryMetric(metric,now)?metric.value-previous.metrics[key].value:null,
        status:previous && usableHistoryMetric(metric,now)?"BUCKET_DELTA":"INSUFFICIENT_BUCKET_HISTORY",unit:"shares",
        previousBucketTime:previous?.metrics[key]?.marketTime??null,currentBucketTime:metric?.marketTime??null};
    }
  }
  const intraday={};
  for(const name of ["samsung","skHynix"]){
    const m=current.metrics,price=m[`${name}.price`],open=m[`${name}.open`],close=m[`${name}.previousClose`];
    const valid=usableHistoryMetric(price,now);
    intraday[name]={fromOpenPct:valid&&usableHistoryMetric(open,now)&&open.value>0?(price.value/open.value-1)*100:null,
      fromPreviousClosePct:valid&&usableHistoryMetric(close,now)&&close.value>0?(price.value/close.value-1)*100:null};
  }
  return {version:1,generatedAt:new Date(now).toISOString(),windows,bucketChanges,intraday,
    sameTimeHistoricalAverage:{status:"NOT_IMPLEMENTED",value:null},
    limitations:["2-minute sampling: inspect actualElapsedSeconds", "RECENT_FETCH is not verified trade freshness", "stock flows use bucket deltas, not fabricated 5-minute flows"]};
}
async function persistMarketHistory(env,payload) {
  if(!historyEnabled(env)) return {status:"DISABLED"};
  if(payload.dataMeta?.session?.status==="HOLIDAY") return {status:"SKIPPED_HOLIDAY"};
  const current=historyObservation(payload);
  if(!isKoreaMarketRelayWindow(current.observed_at_ms)) return {status:"OUTSIDE_WINDOW"};
  const db=env.MARKET_HISTORY;
  const result=await db.prepare(`INSERT INTO market_observations
    (slot_ms,observed_at_ms,available_at_ms,trading_day,schema_version,quality_version,pipeline_status,metrics_json,quality_json)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(slot_ms) DO NOTHING`).bind(
      current.slot_ms,current.observed_at_ms,current.available_at_ms,current.trading_day,current.schema_version,
      current.quality_version,current.pipeline_status,JSON.stringify(current.metrics),JSON.stringify(current.quality)).run();
  if(!result.success) throw new Error("HISTORY_INSERT_FAILED");
  // On retries use the immutable stored observation, not a later in-memory value.
  const stored=await db.prepare("SELECT * FROM market_observations WHERE slot_ms = ?").bind(current.slot_ms).first();
  if(!stored) throw new Error("HISTORY_INSERT_NOT_VISIBLE");
  const rows=await db.prepare(`SELECT slot_ms, observed_at_ms, available_at_ms, trading_day, metrics_json, quality_json FROM market_observations
    WHERE trading_day = ? AND slot_ms <= ? ORDER BY slot_ms DESC LIMIT 331`).bind(current.trading_day,current.slot_ms).all();
  if(!rows.success) throw new Error("HISTORY_READ_FAILED");
  const features=historyFeatures(decodeHistoryRow(stored),rows.results);
  const updated=await db.prepare("UPDATE market_observations SET features_json = ? WHERE slot_ms = ? AND features_json IS NULL").bind(JSON.stringify(features),current.slot_ms).run();
  if(!updated.success) throw new Error("HISTORY_FEATURE_WRITE_FAILED");
  return {status:"STORED",slotMs:current.slot_ms};
}
function scheduleMarketHistory(env,payload,ctx) {
  if(!historyEnabled(env)) return;
  // Independent lifetime: database failures cannot block or reject GitHub writes.
  ctx.waitUntil(persistMarketHistory(env,payload).then(result=>{
    console.log("Market history",result.status,result.slotMs??null);
  }).catch(()=>{ console.error("Market history failed; inspect D1 binding and migration"); }));
}

async function runRelay(env, ctx) {
  const [{ data, ageMs }, kis] = await Promise.all([fetchLiveMarket(env), enrichWithKis(env)]);
  const payload = buildPayload(data, ageMs, kis);
  scheduleMarketHistory(env, payload, ctx);
  await updateGithubFile(env, payload);
  return payload;
}

export default {
  async scheduled(controller, env, ctx) {
    if (!isKoreaMarketRelayWindow(controller.scheduledTime)) return;
    ctx.waitUntil(runRelay(env, ctx).catch(error => {
      console.error("Relay failed:", error);
      throw error;
    }));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      try {
        const payload = await runRelay(env, ctx);
        return Response.json({ ok: true, schemaVersion: payload.schemaVersion, payload });
      } catch (error) {
        return Response.json({ ok: false, error: String(error) }, { status: 500 });
      }
    }
    return Response.json({
      ok: true,
      service: "kr-market-github-relay-v3",
      schemaVersion: 3,
      qualityVersion: QUALITY_VERSION,
      historyVersion: HISTORY_VERSION,
      historyEnabled: historyEnabled(env),
      kisEnabled: kisEnabled(env),
      now: new Date().toISOString()
    });
  }
};
