// background.js — service worker: data fetching, price alerts, keyboard commands

const YAHOO_CHART   = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_SEARCH  = 'https://query1.finance.yahoo.com/v1/finance/search';
const YAHOO_QUOTE   = 'https://query1.finance.yahoo.com/v7/finance/quote';
const CRUMB_URL     = 'https://query1.finance.yahoo.com/v1/test/getcrumb';

const RANGE_PARAMS = {
  '1D':  { interval: '5m',  range: '1d'  },
  '1W':  { interval: '1h',  range: '5d'  },
  '1M':  { interval: '1d',  range: '1mo' },
  '6M':  { interval: '1d',  range: '6mo' },
  '1Y':  { interval: '1wk', range: '1y'  },
  'ALL': { interval: '1mo', range: 'max' },
};

const cache    = {};
const inflight = {};
let   crumb    = null;
const OPTS     = { credentials: 'include', headers: { Accept: 'application/json' } };

async function getCrumb() {
  if (crumb) return crumb;
  try {
    const r = await fetch(CRUMB_URL, OPTS);
    if (r.ok) { const t = await r.text(); if (t && t.length < 20 && !t.startsWith('4')) { crumb = t; return crumb; } }
  } catch (_) {}
  return null;
}

async function fetchTicker(symbol, range) {
  const { interval, range: r } = RANGE_PARAMS[range];
  const c   = await getCrumb();
  const sym = encodeURIComponent(symbol);
  const qs  = `interval=${interval}&range=${r}&includePrePost=true${c ? '&crumb=' + encodeURIComponent(c) : ''}`;

  let res = await fetch(`${YAHOO_CHART}${sym}?${qs}`, OPTS);
  if (res.status === 401 || res.status === 403) { crumb = null; res = await fetch(`${YAHOO_CHART}${sym}?interval=${interval}&range=${r}`, OPTS); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No data returned for this symbol');

  const meta    = result.meta;
  const tsList  = result.timestamp || [];
  const q       = result.indicators.quote[0];
  const closes  = q.close  || [];
  const opens   = q.open   || [];
  const highs   = q.high   || [];
  const lows    = q.low    || [];
  const volumes = q.volume || [];

  const data = tsList
    .map((ts, i) => ({ ts: ts * 1000, price: closes[i], open: opens[i], high: highs[i], low: lows[i], volume: volumes[i] }))
    .filter(d => d.price != null);

  return {
    price:                   meta.regularMarketPrice,
    previousClose:           meta.chartPreviousClose ?? meta.previousClose,
    marketState:             meta.marketState,
    preMarketPrice:          meta.preMarketPrice,
    postMarketPrice:         meta.postMarketPrice,
    preMarketChangePercent:  meta.preMarketChangePercent,
    postMarketChangePercent: meta.postMarketChangePercent,
    currency:                meta.currency || 'USD',
    exchangeName:            meta.fullExchangeName || meta.exchangeName || '',
    shortName:               meta.shortName || meta.longName || symbol,
    data,
  };
}

async function getTicker(symbol, range) {
  const key = `${symbol}:${range}`;
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < 60_000) return cache[key].data;
  if (inflight[key]) return inflight[key];
  const p = fetchTicker(symbol, range)
    .then(d  => { cache[key] = { data: d, ts: Date.now() }; delete inflight[key]; return d; })
    .catch(e => { delete inflight[key]; throw e; });
  inflight[key] = p;
  return p;
}

async function searchYahoo(query) {
  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
  const res = await fetch(url, OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.quotes || []).filter(q => q.symbol && q.quoteType !== 'OPTION').slice(0, 8)
    .map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, type: q.typeDisp || q.quoteType || '', exchange: q.exchDisp || q.exchange || '' }));
}

async function fetchStats(symbol) {
  const c      = await getCrumb();
  const sym    = encodeURIComponent(symbol);
  const fields = [
    'regularMarketPrice','fiftyTwoWeekHigh','fiftyTwoWeekLow',
    'regularMarketDayHigh','regularMarketDayLow',
    'regularMarketVolume','averageDailyVolume3Month',
    'marketCap','trailingPE','forwardPE','epsTrailingTwelveMonths',
    'dividendYield','beta','regularMarketPreviousClose','shortRatio',
  ].join(',');
  const qs  = `symbols=${sym}&fields=${fields}${c ? '&crumb=' + encodeURIComponent(c) : ''}`;
  const res = await fetch(`${YAHOO_QUOTE}?${qs}`, OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const q    = json?.quoteResponse?.result?.[0];
  if (!q) throw new Error('No stats data for this symbol');
  return {
    price:            q.regularMarketPrice,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
    fiftyTwoWeekLow:  q.fiftyTwoWeekLow,
    dayHigh:          q.regularMarketDayHigh,
    dayLow:           q.regularMarketDayLow,
    volume:           q.regularMarketVolume,
    avgVolume:        q.averageDailyVolume3Month,
    marketCap:        q.marketCap,
    peRatio:          q.trailingPE,
    forwardPE:        q.forwardPE,
    eps:              q.epsTrailingTwelveMonths,
    dividendYield:    q.dividendYield,
    beta:             q.beta,
    prevClose:        q.regularMarketPreviousClose,
    shortRatio:       q.shortRatio,
  };
}

async function fetchNews(symbol) {
  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=6`;
  const res = await fetch(url, OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.news || []).slice(0, 6).map(n => ({ title: n.title, url: n.link, publisher: n.publisher, time: n.providerPublishTime * 1000 }));
}

async function fetchQuotes(symbols) {
  const c    = await getCrumb();
  const syms = symbols.map(encodeURIComponent).join(',');
  const qs   = `symbols=${syms}&fields=regularMarketPrice,shortName,currency${c ? '&crumb=' + encodeURIComponent(c) : ''}`;
  const res  = await fetch(`${YAHOO_QUOTE}?${qs}`, OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const out  = {};
  for (const q of (json?.quoteResponse?.result || []))
    out[q.symbol] = { price: q.regularMarketPrice, name: q.shortName || q.symbol, currency: q.currency || 'USD' };
  return out;
}

// ── Price alert checking (every minute) ──────────────────────────────────────
chrome.alarms.create('checkAlerts', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'checkAlerts') return;
  const { alerts } = await chrome.storage.local.get('alerts');
  if (!alerts?.length) return;

  const symbols = [...new Set(alerts.map(a => a.symbol))];
  try {
    const quotes    = await fetchQuotes(symbols);
    const remaining = [];
    for (const alert of alerts) {
      const q   = quotes[alert.symbol];
      if (!q) { remaining.push(alert); continue; }
      const hit = (alert.direction === 'above' && q.price >= alert.target) ||
                  (alert.direction === 'below' && q.price <= alert.target);
      if (hit) {
        // Broadcast toast to all tabs — no chrome.notifications needed
        chrome.tabs.query({}, tabs => {
          tabs.forEach(tab =>
            chrome.tabs.sendMessage(tab.id, { type: 'SHOW_ALERT_TOAST', alert, price: q.price }).catch(() => {})
          );
        });
      } else {
        remaining.push(alert);
      }
    }
    if (remaining.length !== alerts.length) chrome.storage.local.set({ alerts: remaining });
  } catch (e) { console.warn('[StockPeek] Alert check failed:', e.message); }
});

// ── Keyboard command → toggle widget in active tab ────────────────────────────
chrome.commands.onCommand.addListener(cmd => {
  if (cmd !== 'toggle-widget') return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_WIDGET' }).catch(() => {});
  });
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = (fn) => { fn.then(d => sendResponse({ ok: true,  data: d })).catch(e => sendResponse({ ok: false, error: e.message })); return true; };
  if (msg.type === 'GET_TICKER') return handle(getTicker(msg.symbol, msg.range));
  if (msg.type === 'SEARCH_YF')  return handle(searchYahoo(msg.query));
  if (msg.type === 'GET_STATS')  return handle(fetchStats(msg.symbol));
  if (msg.type === 'GET_NEWS')   return handle(fetchNews(msg.symbol));
  if (msg.type === 'GET_QUOTES') return handle(fetchQuotes(msg.symbols));
});
