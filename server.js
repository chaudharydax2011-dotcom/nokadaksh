// server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { fetchHistoricalOHLCV, verifySymbol, fetchBatchLTP } = require('./growwClient');
const { calcRSI, signalFor }                                 = require('./rsi');
const { calcEMA, calcMACD, calcADX, calcScore }             = require('./indicators');

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());

// Static routes
app.get('/',             (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/health',       (req, res) => res.json({ status: 'ok' }));
app.get('/manifest.json',(req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js',        (req, res) => res.sendFile(path.join(__dirname, 'sw.js')));
app.use(express.static(path.join(__dirname, 'public')));

const PORT           = process.env.PORT || 4000;
const MIN_REFRESH_MS = parseInt(process.env.MIN_REFRESH_MS || '15000');

// ── Symbol persistence ──────────────────────────────────────
const SYMBOLS_FILE = path.join(__dirname, 'symbols.json');
let SYMBOLS = [];
const DEFAULT_SYMBOLS = [
  'MAHKTECH','NIFTYBEES','CPSEETF','PHARMABEES','HNGSNGBEES','MON100',
  'JUNIORBEES','ITBEES','HDFCSML250','PSUBNKBEES','FMCGIETF','BANKBEES',
  'MASPTOP50','MOM100','MOM50','GOLDBEES','TNIDETF','SENSEXETF',
  'SILVERBEES','MAKEINDIA','NIFTYQLITY','NV20IETF','SBIETFQLTY'
];

function loadSymbols() {
  try {
    if (fs.existsSync(SYMBOLS_FILE)) {
      SYMBOLS = JSON.parse(fs.readFileSync(SYMBOLS_FILE, 'utf8'));
    } else {
      SYMBOLS = [...DEFAULT_SYMBOLS];
      fs.writeFileSync(SYMBOLS_FILE, JSON.stringify(SYMBOLS, null, 2));
    }
  } catch (err) {
    console.error('Error loading symbols:', err);
    SYMBOLS = [...DEFAULT_SYMBOLS];
  }
}
loadSymbols();

function saveSymbols() {
  try { fs.writeFileSync(SYMBOLS_FILE, JSON.stringify(SYMBOLS, null, 2)); }
  catch (err) { console.error('Error saving symbols:', err); }
}

// ── Cache ───────────────────────────────────────────────────
// cache[symbol] = { closes, highs, lows, volumes, lastFetch, lastQuote }
const cache = {};

// ── Helper: average of last N elements ──────────────────────
function avgLast(arr, n) {
  if (!arr || arr.length === 0) return 0;
  const slice = arr.slice(-n).filter(v => v > 0);
  return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

// ── /api/quotes ─────────────────────────────────────────────
app.get('/api/quotes', async (req, res) => {
  const period = parseInt(req.query.period || '14');
  if (isNaN(period) || period < 2 || period > 50) {
    return res.status(400).json({ error: 'Invalid RSI period. Must be between 2 and 50.' });
  }
  const allSymbols = ['^NSEI', ...SYMBOLS];

  try {
    // 1. Batch-fetch live LTP + change% for all symbols in 2 chunked requests
    const batchQuotes = await fetchBatchLTP(allSymbols);

    const results  = [];
    let niftyData  = null;
    let isAnyMock  = false;

    for (const symbol of allSymbols) {
      const quote = batchQuotes[symbol] || { ltp: null, volume: null, changePct: null, isMock: true };

      // 2. Get OHLCV from cache or fetch fresh
      let { closes = [], highs = [], lows = [], volumes = [] } = cache[symbol] || {};
      const needsRefresh = closes.length < 50;

      if (needsRefresh) {
        try {
          ({ closes, highs, lows, volumes } = await fetchHistoricalOHLCV(symbol, 150));
        } catch (e) {
          closes = []; highs = []; lows = []; volumes = [];
        }
      }

      // 3. Append live LTP to a temporary calc copy (never mutate cached arrays)
      let calcCloses = [...closes];
      let calcHighs  = [...highs];
      let calcLows   = [...lows];
      if (quote.ltp != null) {
        const ltp = quote.ltp;
        if (calcCloses.length === 0) {
          calcCloses = [ltp]; calcHighs = [ltp]; calcLows = [ltp];
        } else {
          const lastH = calcHighs[calcHighs.length - 1] || ltp;
          const lastL = calcLows[calcLows.length - 1] || ltp;
          calcCloses = [...calcCloses, ltp].slice(-150);
          calcHighs  = [...calcHighs, Math.max(lastH, ltp)].slice(-150);
          calcLows   = [...calcLows,  Math.min(lastL, ltp)].slice(-150);
        }
      }

      // 4. Persist OHLCV to cache
      const now = Date.now();
      cache[symbol] = { closes, highs, lows, volumes, lastFetch: now, lastQuote: quote };

      if (quote.isMock) isAnyMock = true;

      // ── Nifty index widget data (no RSI table row) ──
      if (symbol === '^NSEI') {
        niftyData = { ltp: quote.ltp, changePct: quote.changePct, isMock: quote.isMock, closes: calcCloses };
        continue;
      }

      // 5. Calculate all indicators
      const rsi  = calcRSI(calcCloses, period);
      const sig  = signalFor(rsi);
      const ema20 = calcEMA(calcCloses, 20);
      const ema50 = calcEMA(calcCloses, 50);
      const macd  = calcMACD(calcCloses);
      const adx   = calcADX(calcHighs, calcLows, calcCloses);

      // Volume: last day from historical + 20-day avg
      const lastVol = volumes.length > 0 ? volumes[volumes.length - 1] : null;
      const avgVol  = avgLast(volumes, 20);

      const scoreData = calcScore({
        rsi,
        macd,
        ema20,
        ema50,
        adx,
        ltp:        quote.ltp,
        lastVolume: lastVol,
        avgVolume:  avgVol
      });

      results.push({
        symbol,
        ltp:        quote.ltp,
        changePct:  quote.changePct,
        volume:     lastVol,
        avgVolume:  avgVol ? +avgVol.toFixed(0) : null,
        rsi,
        signal:     sig.label,
        color:      sig.color,
        ema20:      ema20 ? +ema20.toFixed(2) : null,
        ema50:      ema50 ? +ema50.toFixed(2) : null,
        ema20Signal: ema20 && quote.ltp ? (quote.ltp > ema20 ? 'ABOVE' : 'BELOW') : null,
        ema50Signal: ema50 && quote.ltp ? (quote.ltp > ema50 ? 'ABOVE' : 'BELOW') : null,
        macd,
        adx,
        score:      scoreData.score,
        scoreLabel: scoreData.label,
        scoreColor: scoreData.color,
        updatedAt:  new Date(now).toISOString(),
        isMock:     quote.isMock,
        closes:     calcCloses
      });
    }

    res.json({ data: results, minRefreshMs: MIN_REFRESH_MS, isMock: isAnyMock, nifty: niftyData });
  } catch (err) {
    console.error('[/api/quotes] Error:', err.message);
    res.status(500).json({ error: 'Internal server error while fetching quotes.' });
  }
});

// ── Add symbol ───────────────────────────────────────────────
app.post('/api/symbols', async (req, res) => {
  let symbol = req.body.symbol;
  if (!symbol || typeof symbol !== 'string') return res.status(400).json({ error: 'Symbol parameter is required' });
  symbol = symbol.trim().toUpperCase();
  if (SYMBOLS.includes(symbol)) return res.status(400).json({ error: 'Symbol already exists' });
  const isValid = await verifySymbol(symbol);
  if (!isValid) return res.status(400).json({ error: 'Invalid NSE symbol. Please verify ticker code.' });
  SYMBOLS.push(symbol);
  saveSymbols();
  res.json({ success: true, symbols: SYMBOLS });
});

// ── Delete symbol ────────────────────────────────────────────
app.delete('/api/symbols/:symbol', (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  const idx = SYMBOLS.indexOf(symbol);
  if (idx === -1) return res.status(404).json({ error: 'Symbol not found' });
  SYMBOLS.splice(idx, 1);
  saveSymbols();
  delete cache[symbol];
  res.json({ success: true, symbols: SYMBOLS });
});

// ── Cache warm-up (on startup) ───────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function warmUpCache() {
  console.log('Warming up OHLCV cache...');
  for (const symbol of ['^NSEI', ...SYMBOLS]) {
    try {
      if (!cache[symbol]?.closes || cache[symbol].closes.length < 50) {
        console.log(`Seeding OHLCV for ${symbol}...`);
        const ohlcv = await fetchHistoricalOHLCV(symbol, 150);
        cache[symbol] = { ...ohlcv, lastFetch: Date.now(), lastQuote: { ltp: null, volume: null, changePct: null, isMock: true } };
        await sleep(150);
      }
    } catch (err) {
      console.error(`Error seeding ${symbol}:`, err.message);
    }
  }
  console.log('OHLCV cache warm-up complete.');
}

app.listen(PORT, () => {
  console.log(`NSE RSI backend running on http://localhost:${PORT}`);
  console.log(`Min refresh: ${MIN_REFRESH_MS}ms`);
  warmUpCache();
});
