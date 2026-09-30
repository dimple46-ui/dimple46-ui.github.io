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
  if (!res.ok) throw new Error(`KIS token HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (!body.access_token) throw new Error(`KIS token missing access_token: ${text.slice(0, 300)}`);

  const expiresIn = Math.max(600, Number(body.expires_in || 86400));
  const value = {
    token: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  await cachePut(env, "kis:access-token:v1", value, Math.max(600, expiresIn - 120));
  return value.token;
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
  if (!res.ok) throw new Error(`KIS ${trId} HTTP ${res.status}: ${text.slice(0, 500)}`);
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
  if (cached) return cached;

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
    scheduledBucket: slot.key,
    fetchedAt: new Date().toISOString(),
    latest: compact.latest,
    rows: compact.rows
  };
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
    return { enabled: true, data: {}, errors: [{ source: "KIS_TOKEN", message: String(e) }] };
  }

  const tasks = [
    ["stockFlowEstimates.samsung", () => getStockFlowEstimate(env, token, "005930", epochMs)],
    ["stockFlowEstimates.skHynix", () => getStockFlowEstimate(env, token, "000660", epochMs)],
    ["futures.kospi200", () => getKospi200Futures(env, token, epochMs)],
    ["futuresInvestors.kospi200", () => getKospi200FuturesInvestors(env, token, epochMs)]
  ];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  const data = { stockFlowEstimates: {}, futures: {}, futuresInvestors: {} };
  settled.forEach((r, i) => {
    const key = tasks[i][0];
    if (r.status === "rejected") {
      errors.push({ source: key, message: String(r.reason) });
      return;
    }
    const [group, field] = key.split(".");
    data[group][field] = r.value;
  });
  return { enabled: true, data, errors };
}

function compactStock(stock) {
  if (!stock) return null;
  return {
    code: stock.code ?? null,
    name: stock.name ?? null,
    marketStatus: stock.marketStatus ?? null,
    previousClose: stock.previousClose ?? null,
    price: stock.price ?? null,
    change: stock.change ?? null,
    changeRate: stock.changeRate ?? null,
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
    tradingValue: index.tradingValue ?? null
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

function buildPayload(data, ageMs, kis) {
  const indexes = Array.isArray(data.indexes) ? data.indexes : [];
  const sourceErrors = Array.isArray(data.errors) ? data.errors : [];
  return {
    schemaVersion: 3,
    fresh: true,
    relayUpdatedAt: new Date().toISOString(),
    sourceFetchedAt: data.fetchedAt,
    sourceAgeSeconds: Math.round(ageMs / 1000),
    koreaDate: data.koreaDate ?? kstYmd(),
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

async function runRelay(env) {
  const [{ data, ageMs }, kis] = await Promise.all([fetchLiveMarket(env), enrichWithKis(env)]);
  const payload = buildPayload(data, ageMs, kis);
  await updateGithubFile(env, payload);
  return payload;
}

export default {
  async scheduled(controller, env, ctx) {
    if (!isKoreaMarketRelayWindow(controller.scheduledTime)) return;
    ctx.waitUntil(runRelay(env).catch(error => {
      console.error("Relay failed:", error);
      throw error;
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      try {
        const payload = await runRelay(env);
        return Response.json({ ok: true, schemaVersion: payload.schemaVersion, payload });
      } catch (error) {
        return Response.json({ ok: false, error: String(error) }, { status: 500 });
      }
    }
    return Response.json({
      ok: true,
      service: "kr-market-github-relay-v3",
      schemaVersion: 3,
      kisEnabled: kisEnabled(env),
      now: new Date().toISOString()
    });
  }
};
