// server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { fetchHistoricalOHLCV, verifySymbol, fetchBatchLTP } = require('./growwClient');
const { calcRSI, signalFor }                                 = require('./rsi');
const { calcEMA, calcMACD, calcADX, calcScore, calcCompositeSignal } = require('./indicators');

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

// ── Helper: check if two timestamps are on the same day in IST ──
function isSameDayIST(ts1Ms, ts2Ms) {
  const d1 = new Date(ts1Ms + 19800000); // UTC+5.5 hours offset
  const d2 = new Date(ts2Ms + 19800000);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth()    === d2.getUTCMonth() &&
         d1.getUTCDate()     === d2.getUTCDate();
}

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

      // 2. Get OHLCV from cache or fetch fresh (5 minutes expiration for live accuracy)
      let { closes = [], highs = [], lows = [], volumes = [], timestamps = [] } = cache[symbol] || {};
      const cacheAgeMs = Date.now() - (cache[symbol]?.lastFetch || 0);
      const needsRefresh = closes.length < 200 || cacheAgeMs > 5 * 60 * 1000;

      if (needsRefresh) {
        try {
          const fresh = await fetchHistoricalOHLCV(symbol, 200);
          closes = fresh.closes;
          highs = fresh.highs;
          lows = fresh.lows;
          volumes = fresh.volumes;
          timestamps = fresh.timestamps;
        } catch (e) {
          console.warn(`Failed to refresh OHLCV for ${symbol}, using cache fallback:`, e.message);
        }
      }

      // 3. Append or update live LTP to a temporary calc copy
      let calcCloses = [...closes];
      let calcHighs  = [...highs];
      let calcLows   = [...lows];
      let calcVolumes = [...volumes];

      if (quote.ltp != null && calcCloses.length > 0) {
        const ltp = quote.ltp;
        const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
        const isToday = isSameDayIST(lastTs * 1000, Date.now());

        if (isToday) {
          // Update today's existing candle in calc copy
          calcCloses[calcCloses.length - 1] = ltp;
          calcHighs[calcHighs.length - 1]   = Math.max(calcHighs[calcHighs.length - 1], ltp);
          calcLows[calcLows.length - 1]     = Math.min(calcLows[calcLows.length - 1], ltp);
          if (quote.volume) {
            calcVolumes[calcVolumes.length - 1] = Math.max(calcVolumes[calcVolumes.length - 1], quote.volume);
          }
        } else {
          // Append as a new candle
          calcCloses.push(ltp);
          calcHighs.push(ltp);
          calcLows.push(ltp);
          calcVolumes.push(quote.volume || 0);
        }
      }

      // 4. Persist OHLCV to cache
      const now = Date.now();

      cache[symbol] = { closes, highs, lows, volumes, timestamps, lastFetch: now, lastQuote: quote };

      if (quote.isMock) isAnyMock = true;

      // ── Nifty index widget data (no RSI table row) ──
      if (symbol === '^NSEI') {
        niftyData = { ltp: quote.ltp, changePct: quote.changePct, isMock: quote.isMock, closes: calcCloses.slice(-200) };
        continue;
      }

      // Slice temporary copies to 200 bars for calculation
      const cCloses = calcCloses.slice(-200);
      const cHighs  = calcHighs.slice(-200);
      const cLows   = calcLows.slice(-200);
      const cVols   = calcVolumes.slice(-200);

      // 5. Calculate all indicators
      const rsi  = calcRSI(cCloses, period);
      const ema20 = calcEMA(cCloses, 20);
      const ema50 = calcEMA(cCloses, 50);
      const macd  = calcMACD(cCloses);

      // For ADX: it should use completed bars only.
      // If today is in the historical data, remove the last bar to use only fully completed sessions.
      let adxHighs = [...highs];
      let adxLows  = [...lows];
      let adxCloses = [...closes];
      if (timestamps.length > 0) {
        const lastTs = timestamps[timestamps.length - 1];
        if (isSameDayIST(lastTs * 1000, Date.now())) {
          adxHighs.pop();
          adxLows.pop();
          adxCloses.pop();
        }
      }
      const adx = calcADX(adxHighs.slice(-200), adxLows.slice(-200), adxCloses.slice(-200));

      // Volume: last day from historical + 20-day avg
      const lastVol = cVols.length > 0 ? cVols[cVols.length - 1] : null;
      const avgVol  = avgLast(cVols, 20);

      // Calculate rule-based Signal and composite Score
      const sig = calcCompositeSignal({
        rsi,
        macd,
        ema20,
        ema50,
        adx,
        ltp: quote.ltp,
        lastVolume: lastVol,
        avgVolume: avgVol
      });

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
        closes:     cCloses
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
        const ohlcv = await fetchHistoricalOHLCV(symbol, 200);
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
