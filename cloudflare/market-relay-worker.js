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
const FEATURE_VERSION = 2;
const SAME_TIME_TOLERANCE_MS = 150000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
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
// Keep the production persistence contract on Feature v1 unless a controlled rollout explicitly opts in.
// Feature v2 is validated by the separate candidate Worker and must not silently replace v1 rows.
function featureEngineV2Enabled(env) {
  return String(env.FEATURE_ENGINE_V2_ENABLED ?? "false") === "true";
}
function historyFeaturesV1(current, rawRows) {
  const now = current.observed_at_ms;
  const rows = rawRows.map(decodeHistoryRow).filter(r => r.trading_day === current.trading_day &&
    r.observed_at_ms <= now && r.available_at_ms <= now).sort((a,b) => a.observed_at_ms-b.observed_at_ms);
  const windows = {};
  for (const minutes of [5,10,30]) {
    const target = now - minutes * 60000;
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
function featureMetricQuality(metric) {
  if (!metric || metric.value == null || !Number.isFinite(metric.value)) return "MISSING_INPUT";
  if (["STALE", "STALE_BUCKET"].includes(metric.status)) return "STALE_INPUT";
  if (metric.status === "RECENT_FETCH") return "UNVERIFIED_TIME";
  return ["LIVE", "CURRENT_BUCKET"].includes(metric.status) ? "VERIFIED" : "UNUSABLE_INPUT";
}
function featureValue(value=null,status="INSUFFICIENT_HISTORY",sampleCount=0,quality="UNKNOWN",extra={}) {
  return {value,status,sampleCount,quality,...extra};
}
function combinedFeatureQuality(...items) {
  const qualities=items.map(item=>item?.quality).filter(Boolean);
  if(qualities.includes("MISSING_INPUT")) return "MISSING_INPUT";
  if(qualities.includes("STALE_INPUT")) return "STALE_INPUT";
  if(qualities.includes("UNUSABLE_INPUT")) return "UNUSABLE_INPUT";
  if(qualities.includes("UNVERIFIED_TIME")) return "UNVERIFIED_TIME";
  return qualities.length&&qualities.every(value=>value==="VERIFIED") ? "VERIFIED" : "UNKNOWN";
}
function average(values) { return values.reduce((sum,value)=>sum+value,0)/values.length; }
function median(values) {
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
function standardDeviation(values,mean=average(values)) {
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);
}
function sameTimeHistoricalBaselines(current, rawRows) {
  const rows=rawRows.map(decodeHistoryRow).filter(row=>row.trading_day<current.trading_day &&
    row.observed_at_ms<=current.observed_at_ms && row.available_at_ms<=current.observed_at_ms)
    .sort((a,b)=>b.observed_at_ms-a.observed_at_ms);
  const generatedAt=new Date(current.observed_at_ms).toISOString();
  const metricNames=["samsung.volume","skHynix.volume","samsung.foreignFlow","samsung.institutionFlow",
    "skHynix.foreignFlow","skHynix.institutionFlow","market.foreigner","market.institution","market.individual",
    "program.arbitrageNet","program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
    "futures.individualNet","futures.openInterest","futures.basis","futures.marketBasis"];
  const windows={};
  for(const days of [5,10,20]){
    const selected=rows.slice(0,days),metrics={};
    for(const name of metricNames){
      const currentMetric=current.metrics[name],quality=featureMetricQuality(currentMetric);
      const values=selected.filter(row=>usableHistoryMetric(row.metrics[name],row.observed_at_ms)).map(row=>row.metrics[name].value);
      let result={status:"INSUFFICIENT_HISTORY",value:null,sampleCount:values.length,requiredSampleCount:days,
        mean:null,median:null,standardDeviation:null,percentile:null,zScore:null,ratioToMean:null,quality};
      if(!usableHistoryMetric(currentMetric,current.observed_at_ms)) result.status=quality;
      else if(selected.length>=days && values.length>=days){
        const mean=average(values),sd=standardDeviation(values,mean);
        result={...result,status:"VALID",value:currentMetric.value,mean,median:median(values),standardDeviation:sd,
          percentile:values.filter(value=>value<=currentMetric.value).length/values.length*100,
          zScore:sd>0?(currentMetric.value-mean)/sd:null,ratioToMean:mean!==0?currentMetric.value/mean:null};
        if(sd===0) result.limitations=["ZERO_VARIANCE_ZSCORE_UNAVAILABLE"];
      }
      metrics[name]=result;
    }
    windows[`${days}d`]={status:selected.length>=days?"AVAILABLE":"INSUFFICIENT_HISTORY",requestedTradingDays:days,
      sampleCount:selected.length,generatedAt,inputCutoff:generatedAt,metrics};
  }
  return {status:rows.length>=5?"AVAILABLE":"INSUFFICIENT_HISTORY",generatedAt,inputCutoff:generatedAt,
    availableTradingDays:rows.length,selection:"LATEST_OBSERVATION_AT_OR_BEFORE_SAME_KST_TIME_WITHIN_150_SECONDS",windows};
}
function pairDirection(primary,secondary,primaryLabel,secondaryLabel) {
  const usableStatuses=new Set(["OK","BUCKET_CHANGE_ONLY"]);
  if(primary?.value==null || secondary?.value==null || !usableStatuses.has(primary?.status) || !usableStatuses.has(secondary?.status))
    return {state:null,status:"INSUFFICIENT_OR_UNUSABLE_INPUT",strength:null,supportingEvidence:[],contraryEvidence:[]};
  const a=Math.sign(primary.value),b=Math.sign(secondary.value);
  let state="MIXED_OR_FLAT";
  if(a!==0&&a===b) state="CONFIRMING";
  else if(a>0&&b<0) state=`${primaryLabel}_UP_${secondaryLabel}_DOWN`;
  else if(a<0&&b>0) state=`${primaryLabel}_DOWN_${secondaryLabel}_UP`;
  return {state,status:"VALID",strength:Math.abs(primary.value),confidence:"UNVALIDATED",
    quality:combinedFeatureQuality(primary,secondary),
    supportingEvidence:[{metric:primaryLabel,value:primary.value},{metric:secondaryLabel,value:secondary.value}],
    contraryEvidence:a!==0&&b!==0&&a!==b?[{reason:"DIRECTION_CONFLICT"}]:[]};
}
function futuresPositionClassification(window) {
  const price=window.metrics["futures.price"],oi=window.metrics["futures.openInterest"];
  if(price?.value==null||oi?.value==null||price?.status!=="OK"||oi?.status!=="OK")
    return {state:null,status:"INSUFFICIENT_OR_UNUSABLE_INPUT",confidence:"NONE",supportingEvidence:[],contraryEvidence:[]};
  const priceDirection=Math.sign(price.value),oiDirection=Math.sign(oi.value);
  let state="MIXED_OR_FLAT";
  if(priceDirection>0&&oiDirection>0) state="NEW_LONG_CANDIDATE";
  else if(priceDirection<0&&oiDirection>0) state="NEW_SHORT_CANDIDATE";
  else if(priceDirection>0&&oiDirection<0) state="SHORT_COVER_CANDIDATE";
  else if(priceDirection<0&&oiDirection<0) state="LONG_LIQUIDATION_CANDIDATE";
  const contraryEvidence=[];
  const supportingEvidence=[{metric:"futures.priceReturnPct",value:price.value},
    {metric:"futures.openInterestDelta",value:oi.value}];
  const foreign=window.metrics["futures.foreignNet"],basis=window.metrics["futures.basis"];
  for(const [name,result] of [["futures.foreignNet",foreign],["futures.basis",basis]]){
    if(result?.status!=="OK"||Math.sign(result.value)===0) continue;
    if(Math.sign(result.value)===priceDirection) supportingEvidence.push({metric:name,value:result.value});
    else contraryEvidence.push({metric:name,value:result.value,reason:"OPPOSES_PRICE_DIRECTION"});
  }
  return {state,status:"VALID",confidence:supportingEvidence.length>=3&&contraryEvidence.length===0?"MEDIUM":"LOW",
    quality:combinedFeatureQuality(price,oi),supportingEvidence,contraryEvidence,
    limitations:["PRICE_AND_OI_HEURISTIC_NOT_CONFIRMED_POSITION_DATA"]};
}
function historyFeatures(current, rawRows, rawSameTimeRows=[]) {
  const now = current.observed_at_ms;
  // The as-of cutoff rejects records collected later, even if backdated.
  const rows = rawRows.map(decodeHistoryRow).filter(r => r.trading_day === current.trading_day &&
    r.observed_at_ms <= now && r.available_at_ms <= now).sort((a,b) => a.observed_at_ms-b.observed_at_ms);
  const windows = {};
  for (const minutes of [2,5,10,30]) {
    const target = now - minutes * 60000;
    // Use only a sample at/before target; no interpolation or future sample.
    const candidates = rows.filter(r => r.observed_at_ms <= target && target-r.observed_at_ms <= 150000);
    const baseline = candidates.at(-1);
    const window = {status: baseline ? "AVAILABLE" : "INSUFFICIENT_HISTORY", requestedMinutes:minutes,
      baselineAt:baseline ? new Date(baseline.observed_at_ms).toISOString() : null,
      actualElapsedSeconds:baseline ? (now-baseline.observed_at_ms)/1000 : null,
      generatedAt:new Date(now).toISOString(),inputCutoff:new Date(now).toISOString(),sampleCount:baseline?2:1,metrics:{}};
    for (const [name, metric] of Object.entries(current.metrics)) {
      const old = baseline?.metrics?.[name];
      const result = featureValue(null,"INSUFFICIENT_HISTORY",baseline?2:1,featureMetricQuality(metric));
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
            if (metric.marketTime === old.marketTime) {
              result.status = "UNCHANGED_BUCKET";
            } else {
              result.value = metric.value - old.value;
              result.status = "BUCKET_CHANGE_ONLY";
              result.unit = "shares";
              result.bucketElapsedSeconds = (Date.parse(metric.marketTime) - Date.parse(old.marketTime)) / 1000;
            }
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
    window.volumeRate = {};
    window.realizedVolatility = {};
    window.momentumAcceleration = {};
    for (const name of ["samsung","skHynix"]) {
      const field=`${name}.volume`, metric=current.metrics[field], old=baseline?.metrics[field], prev=earlier?.metrics[field];
      const result=featureValue(null,"INSUFFICIENT_HISTORY",earlier?3:baseline?2:1,featureMetricQuality(metric),
        {unit:"shares_per_minute_change"});
      if (baseline && earlier && usableHistoryMetric(metric,now) && usableHistoryMetric(old,baseline.observed_at_ms) && usableHistoryMetric(prev,earlier.observed_at_ms)) {
        const d1=metric.value-old.value,d0=old.value-prev.value;
        if(d1>=0 && d0>=0){result.value=d1/((now-baseline.observed_at_ms)/60000)-d0/((baseline.observed_at_ms-earlier.observed_at_ms)/60000);result.status="OK";}
        else result.status="COUNTER_RESET";
      }
      window.volumeAcceleration[name]=result;
      const volumeDelta=window.metrics[field];
      window.volumeRate[name]=featureValue(volumeDelta?.value!=null&&window.actualElapsedSeconds>0?
        volumeDelta.value/(window.actualElapsedSeconds/60):null,volumeDelta?.status??"INSUFFICIENT_HISTORY",
        volumeDelta?.sampleCount??0,volumeDelta?.quality??"UNKNOWN",{unit:"shares_per_minute"});
      const priceField=`${name}.price`,series=baseline?rows.filter(row=>row.observed_at_ms>=baseline.observed_at_ms)
        .filter(row=>usableHistoryMetric(row.metrics[priceField],row.observed_at_ms)).map(row=>row.metrics[priceField].value):[];
      const returns=[];for(let i=1;i<series.length;i++) if(series[i-1]>0&&series[i]>0) returns.push(Math.log(series[i]/series[i-1])*100);
      window.realizedVolatility[name]=featureValue(returns.length?Math.sqrt(returns.reduce((sum,value)=>sum+value**2,0)):null,
        returns.length?"OK":"INSUFFICIENT_HISTORY",returns.length,featureMetricQuality(current.metrics[priceField]),{unit:"log_return_rss_percent"});
      const currentReturn=window.metrics[priceField],oldPrice=baseline?.metrics[priceField],previousPrice=earlier?.metrics[priceField];
      let acceleration=null,status="INSUFFICIENT_HISTORY";
      if(currentReturn?.status==="OK"&&usableHistoryMetric(oldPrice,baseline.observed_at_ms)&&usableHistoryMetric(previousPrice,earlier?.observed_at_ms)&&previousPrice.value>0){
        acceleration=currentReturn.value-(oldPrice.value/previousPrice.value-1)*100;status="OK";
      }
      window.momentumAcceleration[name]=featureValue(acceleration,status,acceleration==null?0:3,featureMetricQuality(current.metrics[priceField]),{unit:"percentage_points"});
    }
    window.acceleration={};
    window.direction={};
    for(const field of ["market.foreigner","market.institution","market.individual","program.arbitrageNet",
      "program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
      "futures.individualNet","futures.openInterest"]){
      const currentDelta=window.metrics[field],old=baseline?.metrics[field],previous=earlier?.metrics[field];
      let value=null,status="INSUFFICIENT_HISTORY";
      if(currentDelta?.status==="OK"&&usableHistoryMetric(old,baseline?.observed_at_ms)&&
        usableHistoryMetric(previous,earlier?.observed_at_ms)){
        const currentMinutes=(now-baseline.observed_at_ms)/60000;
        const previousMinutes=(baseline.observed_at_ms-earlier.observed_at_ms)/60000;
        if(currentMinutes>0&&previousMinutes>0){
          value=currentDelta.value/currentMinutes-(old.value-previous.value)/previousMinutes;status="OK";
        }
      }
      window.acceleration[field]=featureValue(value,status,value==null?0:3,featureMetricQuality(current.metrics[field]),
        {unit:"value_per_minute_change"});
      window.direction[field]={state:currentDelta?.value==null?null:currentDelta.value>0?"INCREASING":
        currentDelta.value<0?"DECREASING":"UNCHANGED",status:currentDelta?.status??"INSUFFICIENT_HISTORY",
        quality:currentDelta?.quality??"UNKNOWN"};
    }
    window.relativeStrength={};
    for(const [a,b] of [["samsung","skHynix"],["samsung","kospi"],["skHynix","kospi"],["samsung","kospi200"],["skHynix","kospi200"]]) {
      const av=window.metrics[`${a}.price`],bv=window.metrics[`${b}.price`];
      window.relativeStrength[`${a}_vs_${b}`]=featureValue(av?.value!=null&&bv?.value!=null?av.value-bv.value:null,
        av?.status==="OK"&&bv?.status==="OK"?"OK":"INSUFFICIENT_OR_UNUSABLE_INPUT",
        Math.min(av?.sampleCount??0,bv?.sampleCount??0),combinedFeatureQuality(av,bv),{unit:"percentage_points",
          components:{primaryReturnPct:av?.value??null,secondaryReturnPct:bv?.value??null}});
    }
    window.futuresPosition=futuresPositionClassification(window);
    window.divergences={
      cashVsFutures:pairDirection(window.metrics["kospi.price"],window.metrics["futures.price"],"CASH","FUTURES"),
      samsungVsSkHynix:pairDirection(window.metrics["samsung.price"],window.metrics["skHynix.price"],"SAMSUNG","SK_HYNIX"),
      samsungPriceVsForeignFlow:pairDirection(window.metrics["samsung.price"],window.metrics["samsung.foreignFlow"],"PRICE","FOREIGN_FLOW"),
      samsungPriceVsInstitutionFlow:pairDirection(window.metrics["samsung.price"],window.metrics["samsung.institutionFlow"],"PRICE","INSTITUTION_FLOW"),
      skHynixPriceVsForeignFlow:pairDirection(window.metrics["skHynix.price"],window.metrics["skHynix.foreignFlow"],"PRICE","FOREIGN_FLOW"),
      skHynixPriceVsInstitutionFlow:pairDirection(window.metrics["skHynix.price"],window.metrics["skHynix.institutionFlow"],"PRICE","INSTITUTION_FLOW"),
      samsungPriceVsProgram:pairDirection(window.metrics["samsung.price"],window.metrics["program.totalNet"],"PRICE","PROGRAM"),
      skHynixPriceVsProgram:pairDirection(window.metrics["skHynix.price"],window.metrics["program.totalNet"],"PRICE","PROGRAM"),
      samsungPriceVsFuturesForeign:pairDirection(window.metrics["samsung.price"],window.metrics["futures.foreignNet"],"PRICE","FUTURES_FOREIGN"),
      skHynixPriceVsFuturesForeign:pairDirection(window.metrics["skHynix.price"],window.metrics["futures.foreignNet"],"PRICE","FUTURES_FOREIGN"),
      samsungPriceVsOpenInterest:pairDirection(window.metrics["samsung.price"],window.metrics["futures.openInterest"],"PRICE","OPEN_INTEREST"),
      skHynixPriceVsOpenInterest:pairDirection(window.metrics["skHynix.price"],window.metrics["futures.openInterest"],"PRICE","OPEN_INTEREST")
    };
    windows[`${minutes}m`]=window;
  }
  const bucketChanges={};
  for(const name of ["samsung","skHynix"]){
    bucketChanges[name]={};
    for(const field of ["foreignFlow","institutionFlow"]){
      const key=`${name}.${field}`,metric=current.metrics[key];
      const sameBucket=rows.filter(r=>r.observed_at_ms<now&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime===metric?.marketTime).at(-1);
      const previous=rows.filter(r=>r.observed_at_ms<now&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime!==metric?.marketTime).at(-1);
      const previousPrevious=previous?rows.filter(r=>r.observed_at_ms<previous.observed_at_ms&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime!==previous.metrics[key].marketTime).at(-1):null;
      const validCurrent=usableHistoryMetric(metric,now),isNewBucket=validCurrent&&!sameBucket;
      const value=isNewBucket&&previous?metric.value-previous.metrics[key].value:null;
      const priorDelta=previous&&previousPrevious?previous.metrics[key].value-previousPrevious.metrics[key].value:null;
      const stockVolume=current.metrics[`${name}.volume`];
      bucketChanges[name][field]={value,status:!validCurrent?featureMetricQuality(metric):sameBucket?"BUCKET_UNCHANGED":
        previous?"BUCKET_DELTA":"INSUFFICIENT_BUCKET_HISTORY",unit:"shares",sampleCount:value==null?0:2,
        quality:featureMetricQuality(metric),direction:value==null?null:value>0?"INCREASING":value<0?"DECREASING":"UNCHANGED",
        acceleration:value!=null&&priorDelta!=null?value-priorDelta:null,
        accelerationStatus:value!=null&&priorDelta!=null?"VALID":"INSUFFICIENT_BUCKET_HISTORY",
        shareOfVolumePct:value!=null&&usableHistoryMetric(stockVolume,now)&&stockVolume.value>0?value/stockVolume.value*100:null,
        previousBucketTime:previous?.metrics[key]?.marketTime??null,currentBucketTime:metric?.marketTime??null,
        limitations:["DISCRETE_ESTIMATE_BUCKET_NOT_CONTINUOUS_FLOW","SHARE_OF_VOLUME_USES_QUANTITY_NOT_TRADING_VALUE"]};
    }
  }
  const intraday={returns:{},relativeStrength:{}};
  const firstRow=rows.find(row=>row.observed_at_ms<now);
  for(const name of ["samsung","skHynix","kospi","kospi200","futures"]){
    const key=`${name}.price`,metric=current.metrics[key],first=firstRow?.metrics?.[key];
    intraday.returns[name]=featureValue(usableHistoryMetric(metric,now)&&usableHistoryMetric(first,firstRow?.observed_at_ms)&&first.value>0?
      (metric.value/first.value-1)*100:null,usableHistoryMetric(metric,now)&&usableHistoryMetric(first,firstRow?.observed_at_ms)&&first.value>0?"OK":"INSUFFICIENT_HISTORY",
      firstRow?2:1,featureMetricQuality(metric),{unit:"percent",baselineAt:firstRow?new Date(firstRow.observed_at_ms).toISOString():null});
  }
  for(const [a,b] of [["samsung","skHynix"],["samsung","kospi"],["skHynix","kospi"],["samsung","kospi200"],["skHynix","kospi200"]]){
    const av=intraday.returns[a],bv=intraday.returns[b];intraday.relativeStrength[`${a}_vs_${b}`]=featureValue(
      av.value!=null&&bv.value!=null?av.value-bv.value:null,av.value!=null&&bv.value!=null?"OK":"INSUFFICIENT_HISTORY",
      Math.min(av.sampleCount,bv.sampleCount),av.quality==="VERIFIED"&&bv.quality==="VERIFIED"?"VERIFIED":"UNVERIFIED_TIME",{unit:"percentage_points"});
  }
  for(const name of ["samsung","skHynix"]){
    const m=current.metrics,price=m[`${name}.price`],open=m[`${name}.open`],close=m[`${name}.previousClose`];
    const valid=usableHistoryMetric(price,now);
    const high=m[`${name}.high`],low=m[`${name}.low`],volume=m[`${name}.volume`],tradingValue=m[`${name}.tradingValue`];
    const vwap=valid&&usableHistoryMetric(volume,now)&&usableHistoryMetric(tradingValue,now)&&volume.value>0?tradingValue.value/volume.value:null;
    const intradayQuality=featureMetricQuality(price);
    intraday[name]={fromOpenPct:valid&&usableHistoryMetric(open,now)&&open.value>0?(price.value/open.value-1)*100:null,
      fromPreviousClosePct:valid&&usableHistoryMetric(close,now)&&close.value>0?(price.value/close.value-1)*100:null,
      highLowPosition:valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?(price.value-low.value)/(high.value-low.value):null,
      vwap,vwapDeviationPct:vwap>0?(price.value/vwap-1)*100:null,
      status:valid?"VALID":intradayQuality,quality:intradayQuality,
      metrics:{fromOpenPct:featureValue(valid&&usableHistoryMetric(open,now)&&open.value>0?(price.value/open.value-1)*100:null,
          valid&&usableHistoryMetric(open,now)&&open.value>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",2,combinedFeatureQuality(
            {quality:intradayQuality},{quality:featureMetricQuality(open)}),{unit:"percent"}),
        fromPreviousClosePct:featureValue(valid&&usableHistoryMetric(close,now)&&close.value>0?(price.value/close.value-1)*100:null,
          valid&&usableHistoryMetric(close,now)&&close.value>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",2,combinedFeatureQuality(
            {quality:intradayQuality},{quality:featureMetricQuality(close)}),{unit:"percent"}),
        highLowPosition:featureValue(valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?
          (price.value-low.value)/(high.value-low.value):null,valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?
          "VALID":"MISSING_OR_UNUSABLE_INPUT",3,combinedFeatureQuality({quality:intradayQuality},{quality:featureMetricQuality(high)},
            {quality:featureMetricQuality(low)}),{unit:"zero_to_one"}),
        vwapDeviationPct:featureValue(vwap>0?(price.value/vwap-1)*100:null,vwap>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",3,
          combinedFeatureQuality({quality:intradayQuality},{quality:featureMetricQuality(volume)},{quality:featureMetricQuality(tradingValue)}),
          {unit:"percent",vwap})}};
  }
  const relativeStrength={availableHorizons:["2m","5m","10m","30m","intraday"],
    locations:{pointInTime:"windows.<horizon>.relativeStrength",intraday:"intraday.relativeStrength"}};
  const sameTimeHistorical=sameTimeHistoricalBaselines(current,rawSameTimeRows);
  return {version:FEATURE_VERSION,generatedAt:new Date(now).toISOString(),inputCutoff:new Date(now).toISOString(),windows,bucketChanges,intraday,
    relativeStrength,sameTimeHistorical,sameTimeHistoricalAverage:{status:"RENAMED",path:"sameTimeHistorical"},
    limitations:["2-minute sampling: inspect actualElapsedSeconds", "RECENT_FETCH has unverified exchange time", "stock flows use bucket deltas, not fabricated continuous flows", "stock-flow/trading-value ratio is unavailable because stock flow is quantity, not value", "same-time statistics require complete trading-day samples", "divergence and futures position states are descriptive, not BUY/SELL signals"]};
}

// Feature v2 storage is additive. market_observations and legacy features_json are never rewritten here.
const COMPACT_WINDOW_METRICS = [
  "samsung.price","skHynix.price","samsung.foreignFlow","samsung.institutionFlow",
  "skHynix.foreignFlow","skHynix.institutionFlow","market.foreigner","market.institution","market.individual",
  "program.arbitrageNet","program.nonArbitrageNet","program.totalNet","futures.price","futures.foreignNet",
  "futures.institutionNet","futures.individualNet","futures.openInterest","futures.openInterestChange",
  "futures.basis","futures.marketBasis"
];
const COMPACT_ACCELERATION_METRICS = [
  "market.foreigner","market.institution","market.individual","program.arbitrageNet",
  "program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
  "futures.individualNet","futures.openInterest"
];
const COMPACT_STOCKS = ["samsung","skHynix"];
const COMPACT_RELATIVE_STRENGTH = [
  "samsung_vs_skHynix","samsung_vs_kospi","skHynix_vs_kospi","samsung_vs_kospi200","skHynix_vs_kospi200"
];
const COMPACT_DIVERGENCES = [
  "cashVsFutures","samsungVsSkHynix","samsungPriceVsForeignFlow","samsungPriceVsInstitutionFlow",
  "skHynixPriceVsForeignFlow","skHynixPriceVsInstitutionFlow","samsungPriceVsProgram","skHynixPriceVsProgram",
  "samsungPriceVsFuturesForeign","skHynixPriceVsFuturesForeign","samsungPriceVsOpenInterest","skHynixPriceVsOpenInterest"
];
const COMPACT_SAME_TIME_METRICS = [
  "samsung.volume","skHynix.volume","samsung.foreignFlow","samsung.institutionFlow",
  "skHynix.foreignFlow","skHynix.institutionFlow","market.foreigner","market.institution","market.individual",
  "program.arbitrageNet","program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
  "futures.individualNet","futures.openInterest","futures.basis","futures.marketBasis"
];
function encodeCompactCode(codes,kind,value) {
  if(value==null) return null;
  const normalized=String(value),values=codes[kind];
  let index=values.indexOf(normalized);
  if(index<0){ index=values.length;values.push(normalized); }
  return index;
}
function encodeFeatureMetric(metric,codes) {
  return metric?[metric.value??null,encodeCompactCode(codes,"status",metric.status),
    encodeCompactCode(codes,"quality",metric.quality),metric.sampleCount??null,
    encodeCompactCode(codes,"timeBasis",metric.timeBasis),metric.bucketElapsedSeconds??null]:null;
}
function encodeFeatureState(state,codes) {
  return state?[encodeCompactCode(codes,"state",state.state),encodeCompactCode(codes,"status",state.status),
    encodeCompactCode(codes,"quality",state.quality),state.strength??null,state.confidence??null]:null;
}
function compactHistoryFeatures(features) {
  const codes={status:[],quality:[],timeBasis:[],state:[],direction:[]},windows={};
  for(const horizon of ["2m","5m","10m","30m"]){
    const window=features.windows?.[horizon];
    if(!window) continue;
    windows[horizon]={meta:[encodeCompactCode(codes,"status",window.status),window.baselineAt,
        window.actualElapsedSeconds,window.sampleCount],
      metrics:COMPACT_WINDOW_METRICS.map(name=>encodeFeatureMetric(window.metrics?.[name],codes)),
      acceleration:COMPACT_ACCELERATION_METRICS.map(name=>encodeFeatureMetric(window.acceleration?.[name],codes)),
      volumeAcceleration:COMPACT_STOCKS.map(name=>encodeFeatureMetric(window.volumeAcceleration?.[name],codes)),
      volumeRate:COMPACT_STOCKS.map(name=>encodeFeatureMetric(window.volumeRate?.[name],codes)),
      realizedVolatility:COMPACT_STOCKS.map(name=>encodeFeatureMetric(window.realizedVolatility?.[name],codes)),
      momentumAcceleration:COMPACT_STOCKS.map(name=>encodeFeatureMetric(window.momentumAcceleration?.[name],codes)),
      relativeStrength:COMPACT_RELATIVE_STRENGTH.map(name=>encodeFeatureMetric(window.relativeStrength?.[name],codes)),
      futuresPosition:encodeFeatureState(window.futuresPosition,codes),
      divergences:COMPACT_DIVERGENCES.map(name=>encodeFeatureState(window.divergences?.[name],codes))};
  }
  const bucketChanges=COMPACT_STOCKS.map(stock=>["foreignFlow","institutionFlow"].map(name=>{
    const value=features.bucketChanges?.[stock]?.[name];
    return value?[value.value??null,encodeCompactCode(codes,"status",value.status),
      encodeCompactCode(codes,"quality",value.quality),encodeCompactCode(codes,"direction",value.direction),
      value.acceleration??null,encodeCompactCode(codes,"status",value.accelerationStatus),value.shareOfVolumePct??null,
      value.previousBucketTime??null,value.currentBucketTime??null]:null;
  }));
  const intraday={returns:["samsung","skHynix","kospi","kospi200","futures"].map(name=>
      encodeFeatureMetric(features.intraday?.returns?.[name],codes)),
    relativeStrength:COMPACT_RELATIVE_STRENGTH.map(name=>encodeFeatureMetric(features.intraday?.relativeStrength?.[name],codes)),
    stocks:COMPACT_STOCKS.map(stock=>{
      const value=features.intraday?.[stock];
      return value?[encodeCompactCode(codes,"status",value.status),encodeCompactCode(codes,"quality",value.quality),
        ["fromOpenPct","fromPreviousClosePct","highLowPosition","vwapDeviationPct"].map(name=>
          encodeFeatureMetric(value.metrics?.[name],codes))]:null;
    })};
  const sameTime=features.sameTimeHistorical||{},sameTimeWindows={};
  for(const [horizon,window] of Object.entries(sameTime.windows||{})){
    sameTimeWindows[horizon]={meta:[encodeCompactCode(codes,"status",window.status),window.requestedTradingDays,window.sampleCount],
      metrics:COMPACT_SAME_TIME_METRICS.map(name=>{
        const metric=window.metrics?.[name];
        return metric?[metric.value??null,encodeCompactCode(codes,"status",metric.status),
          encodeCompactCode(codes,"quality",metric.quality),metric.sampleCount??null,metric.requiredSampleCount??null,
          metric.mean,metric.median,metric.standardDeviation,metric.percentile,metric.zScore,metric.ratioToMean]:null;
      })};
  }
  return {encodingVersion:1,featureVersion:features.version,
    codes,order:{windowMetrics:COMPACT_WINDOW_METRICS,accelerationMetrics:COMPACT_ACCELERATION_METRICS,stocks:COMPACT_STOCKS,
      relativeStrength:COMPACT_RELATIVE_STRENGTH,divergences:COMPACT_DIVERGENCES,sameTimeMetrics:COMPACT_SAME_TIME_METRICS,
      metricTuple:["value","statusCode","qualityCode","sampleCount","timeBasisCode","bucketElapsedSeconds"],
      stateTuple:["stateCode","statusCode","qualityCode","strength","confidence"]},
    windows,bucketChanges,intraday,
    sameTimeHistorical:{meta:[encodeCompactCode(codes,"status",sameTime.status),sameTime.availableTradingDays],
      windows:sameTimeWindows}};
}
function jsonByteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
const MAX_COMPACT_FEATURE_BYTES = 65536;
const MAX_FEATURE_VALIDATION_BYTES = 32768;
function serializeCompactFeatureRun(run) {
  if(run.featureVersion!==FEATURE_VERSION) throw new Error("FEATURE_VERSION_MISMATCH");
  if(!Number.isSafeInteger(run.slotMs)||!Number.isSafeInteger(run.observedAtMs)||
      !Number.isSafeInteger(run.inputCutoffMs)||!Number.isSafeInteger(run.generatedAtMs))
    throw new Error("INVALID_FEATURE_RUN_TIMESTAMP");
  if(run.inputCutoffMs!==run.observedAtMs||run.generatedAtMs<run.inputCutoffMs)
    throw new Error("INVALID_FEATURE_RUN_CUTOFF");
  if(!/^[0-9a-f]{64}$/i.test(String(run.engineSourceSha256||"")))
    throw new Error("INVALID_FEATURE_SOURCE_SHA");
  let compactFeaturesJson,validationJson;
  try {
    compactFeaturesJson=JSON.stringify(run.compactFeatures);
    validationJson=JSON.stringify(run.validation);
  } catch {
    throw new Error("FEATURE_SERIALIZATION_FAILED");
  }
  if(typeof compactFeaturesJson!=="string"||typeof validationJson!=="string")
    throw new Error("FEATURE_SERIALIZATION_FAILED");
  const compactFeaturesBytes=new TextEncoder().encode(compactFeaturesJson).length;
  const validationBytes=new TextEncoder().encode(validationJson).length;
  if(compactFeaturesBytes>MAX_COMPACT_FEATURE_BYTES||validationBytes>MAX_FEATURE_VALIDATION_BYTES)
    throw new Error("FEATURE_PAYLOAD_TOO_LARGE");
  return {compactFeaturesJson,validationJson,compactFeaturesBytes,validationBytes};
}
function normalizedD1Meta(result) {
  const meta=result?.meta||{};
  const finite=value=>value==null||value===""?null:(Number.isFinite(Number(value))?Number(value):null);
  return {durationMs:finite(meta.duration),rowsRead:finite(meta.rows_read),rowsWritten:finite(meta.rows_written),
    changes:finite(meta.changes),servedBy:meta.served_by??null};
}
function featureValidationSummary(features, compactFeatures, queryMeta={}) {
  const statusCounts={},qualityCounts={};
  let metricLeaves=0,nullLeaves=0,numericLeaves=0;
  const visit=value=>{
    if(!value||typeof value!=="object") return;
    if(Object.prototype.hasOwnProperty.call(value,"status")&&Object.prototype.hasOwnProperty.call(value,"value")){
      metricLeaves++;
      const status=String(value.status??"UNKNOWN"),quality=String(value.quality??"UNKNOWN");
      statusCounts[status]=(statusCounts[status]||0)+1;qualityCounts[quality]=(qualityCounts[quality]||0)+1;
      if(value.value==null) nullLeaves++; else if(typeof value.value==="number"&&Number.isFinite(value.value)) numericLeaves++;
    }
    for(const child of Object.values(value)) visit(child);
  };
  visit(features);
  const qualityOrder=["VERIFIED","UNKNOWN","UNVERIFIED_TIME","STALE_INPUT","UNUSABLE_INPUT","MISSING_INPUT"];
  let qualityRank=0;
  for(const quality of Object.keys(qualityCounts)) qualityRank=Math.max(qualityRank,
    qualityOrder.indexOf(quality)<0?qualityOrder.indexOf("UNKNOWN"):qualityOrder.indexOf(quality));
  const qualityCeiling=qualityOrder[qualityRank];
  const fullFeatureBytes=jsonByteLength(features),compactFeatureBytes=jsonByteLength(compactFeatures);
  const windowsAvailable=["2m","5m","10m","30m"].filter(horizon=>features.windows?.[horizon]?.status==="AVAILABLE");
  const changedBucketObserved=Object.values(features.bucketChanges||{}).some(flows=>
    Object.values(flows||{}).some(metric=>metric?.status==="BUCKET_DELTA"));
  return {featureVersion:features.version,windowsAvailable,metricLeaves,numericLeaves,nullLeaves,
    nullRatio:metricLeaves?nullLeaves/metricLeaves:null,statusCounts,qualityCounts,qualityCeiling,
    changedBucketObserved,fullFeatureBytes,compactFeatureBytes,
    reductionPct:fullFeatureBytes?100-compactFeatureBytes/fullFeatureBytes*100:null,queryMeta};
}
function buildCompactFeatureRun(current,features,{engineGitSha,engineSourceSha256,queryMeta={},generatedAtMs=Date.now()}={}) {
  if(features?.version!==FEATURE_VERSION) throw new Error("FEATURE_VERSION_MISMATCH");
  const compactFeatures=compactHistoryFeatures(features);
  const validation=featureValidationSummary(features,compactFeatures,queryMeta);
  const generationStatus=validation.windowsAvailable.length===4?"SUCCESS":"PARTIAL";
  const run={slotMs:current.slot_ms,featureVersion:features.version,observedAtMs:current.observed_at_ms,
    tradingDay:current.trading_day,engineGitSha,engineSourceSha256,generatedAtMs,inputCutoffMs:current.observed_at_ms,
    qualityCeiling:validation.qualityCeiling,generationStatus,compactFeatures,validation};
  return {...run,...serializeCompactFeatureRun(run)};
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
  const useV2=featureEngineV2Enabled(env);
  let sameTimeRows={success:true,results:[]};
  if(useV2){
    const sameTimeOfDayMs=(current.observed_at_ms+KST_OFFSET_MS)%86400000;
    sameTimeRows=await db.prepare(`WITH recent_days AS (
        SELECT trading_day FROM market_observations WHERE trading_day < ? GROUP BY trading_day ORDER BY trading_day DESC LIMIT 20
      ) SELECT slot_ms, observed_at_ms, available_at_ms, trading_day, metrics_json, quality_json FROM (
        SELECT observation.slot_ms, observation.observed_at_ms, observation.available_at_ms, observation.trading_day,
          observation.metrics_json, observation.quality_json,
          ROW_NUMBER() OVER (PARTITION BY trading_day ORDER BY observed_at_ms DESC) AS same_time_rank
        FROM market_observations AS observation INNER JOIN recent_days USING (trading_day)
        WHERE available_at_ms <= ? AND ((observed_at_ms + ?) % 86400000) BETWEEN ? AND ?
      ) WHERE same_time_rank = 1 ORDER BY trading_day DESC LIMIT 20`).bind(current.trading_day,current.observed_at_ms,KST_OFFSET_MS,
        Math.max(0,sameTimeOfDayMs-SAME_TIME_TOLERANCE_MS),sameTimeOfDayMs).all();
    if(!sameTimeRows.success) throw new Error("HISTORY_SAME_TIME_READ_FAILED");
  }
  const features=useV2?historyFeatures(decodeHistoryRow(stored),rows.results,sameTimeRows.results):
    historyFeaturesV1(decodeHistoryRow(stored),rows.results);
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
