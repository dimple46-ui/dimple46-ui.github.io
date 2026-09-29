const SOURCE_URL = "https://live.dimple3691.workers.dev/market";
const TARGET_PATH = "market-live.json";
const BRANCH = "main";

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

async function githubRequest(env, path, init = {}) {
  const res = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "kr-market-relay",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
  return res;
}

async function fetchLiveMarket() {
  const res = await fetch(`${SOURCE_URL}?t=${Date.now()}`, {
    headers: {
      "Accept": "application/json",
      "Cache-Control": "no-cache"
    },
    cf: {
      cacheTtl: 0,
      cacheEverything: false
    }
  });

  if (!res.ok) {
    throw new Error(`Live source HTTP ${res.status}`);
  }

  const data = await res.json();

  if (!data?.fetchedAt) {
    throw new Error("Live source missing fetchedAt");
  }

  const sourceMs = Date.parse(data.fetchedAt);
  const ageMs = Date.now() - sourceMs;

  if (!Number.isFinite(sourceMs)) {
    throw new Error("Invalid fetchedAt");
  }

  // 현재보다 60초 이상 미래이거나 3분 이상 오래된 데이터는 거부
  if (ageMs < -60_000 || ageMs > 180_000) {
    throw new Error(
      `Stale live data: ${Math.round(ageMs / 1000)} seconds old`
    );
  }

  return { data, ageMs };
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
    closingPrice: item.krx?.closingPrice != null
      ? Number(item.krx.closingPrice)
      : null,
    foreignNetVolume: item.krx?.foreignNetVolume != null
      ? Number(item.krx.foreignNetVolume)
      : null,
    organizationNetVolume: item.krx?.organizationNetVolume != null
      ? Number(item.krx.organizationNetVolume)
      : null,
    individualNetVolume: item.krx?.individualNetVolume != null
      ? Number(item.krx.individualNetVolume)
      : null,
    tradingVolume: item.krx?.tradingVolume != null
      ? Number(item.krx.tradingVolume)
      : null
  };
}

function buildPayload(data, ageMs) {
  const indexes = Array.isArray(data.indexes) ? data.indexes : [];

  return {
    schemaVersion: 1,
    fresh: true,
    relayUpdatedAt: new Date().toISOString(),
    sourceFetchedAt: data.fetchedAt,
    sourceAgeSeconds: Math.round(ageMs / 1000),
    koreaDate: data.koreaDate ?? null,

    stocks: {
      samsung: compactStock(data.stocks?.samsung),
      skHynix: compactStock(data.stocks?.skHynix)
    },

    indexes: {
      kospi: compactIndex(indexes.find(x => x.code === "KOSPI")),
      kospi200: compactIndex(indexes.find(x => x.code === "KPI200"))
    },

    kospiInvestors: {
      bizdate: data.kospiInvestors?.bizdate ?? null,
      time: data.kospiInvestors?.time ?? null,
      summary: data.kospiInvestors?.summary ?? null
    },

    program: data.program
      ? {
          bizdate: data.program.bizdate ?? null,
          time: data.program.time ?? null,
          arbitrageNet: data.program.arbitrageNet ?? null,
          nonArbitrageNet: data.program.nonArbitrageNet ?? null,
          totalNet: data.program.totalNet ?? null
        }
      : null,

    lastConfirmedStockFlow: {
      samsung: latestConfirmedFlow(data.stockInvestorHistory?.samsung),
      skHynix: latestConfirmedFlow(data.stockInvestorHistory?.skHynix)
    },

    sourceErrors: Array.isArray(data.errors) ? data.errors : []
  };
}

async function updateGithubFile(env, payload) {
  if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");
  if (!env.REPO_FULL_NAME) throw new Error("Missing REPO_FULL_NAME");

  const { owner, repo } = parseRepo(env.REPO_FULL_NAME);
  const encodedPath = TARGET_PATH.split("/").map(encodeURIComponent).join("/");

  const getRes = await githubRequest(
    env,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(BRANCH)}`
  );

  let currentSha = null;

  if (getRes.ok) {
    const current = await getRes.json();
    currentSha = current.sha ?? null;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    throw new Error(`GitHub GET ${getRes.status}: ${text.slice(0, 300)}`);
  }

  const content = JSON.stringify(payload, null, 2);
  const body = {
    message: `Update live market snapshot ${payload.sourceFetchedAt}`,
    content: utf8ToBase64(content),
    branch: BRANCH
  };

  if (currentSha) body.sha = currentSha;

  const putRes = await githubRequest(
    env,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      body: JSON.stringify(body)
    }
  );

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${text.slice(0, 500)}`);
  }

  return await putRes.json();
}

function isKoreaMarketRelayWindow(epochMs) {
  const kst = new Date(epochMs + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=Sun, 6=Sat
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();

  if (day === 0 || day === 6) return false;
  if (hour < 9 || hour > 15) return false;
  if (hour === 15 && minute > 30) return false;

  return true;
}

async function runRelay(env) {
  const { data, ageMs } = await fetchLiveMarket();
  const payload = buildPayload(data, ageMs);
  await updateGithubFile(env, payload);
  return payload;
}

export default {
  async scheduled(controller, env, ctx) {
    if (!isKoreaMarketRelayWindow(controller.scheduledTime)) {
      return;
    }

    ctx.waitUntil(
      runRelay(env).catch(error => {
        console.error("Relay failed:", error);
        throw error;
      })
    );
  },

  async fetch() {
    return Response.json({
      ok: true,
      service: "kr-market-github-relay",
      note: "Scheduled relay is active. Live market data is written to GitHub.",
      now: new Date().toISOString()
    });
  }
};
