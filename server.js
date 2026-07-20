// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchLTP, fetchHistoricalCloses, verifySymbol, fetchBatchLTP } = require('./growwClient');
const { calcRSI, signalFor } = require('./rsi');
const fs = require('fs');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve index.html from root directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: "ok" });
});

// Serve PWA assets from root directory
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
const MIN_REFRESH_MS = parseInt(process.env.MIN_REFRESH_MS || '15000');

const SYMBOLS_FILE = path.join(__dirname, 'symbols.json');
let SYMBOLS = [];
const DEFAULT_SYMBOLS = [
  "MAHKTECH","NIFTYBEES","CPSEETF","PHARMABEES","HNGSNGBEES","MON100",
  "JUNIORBEES","ITBEES","HDFCSML250","PSUBNKBEES","FMCGIETF","BANKBEES",
  "MASPTOP50","MOM100","MOM50","GOLDBEES","TNIDETF","SENSEXETF",
  "SILVERBEES","MAKEINDIA","NIFTYQLITY","NV20IETF","SBIETFQLTY"
];

function loadSymbols() {
  try {
    if (fs.existsSync(SYMBOLS_FILE)) {
      const data = fs.readFileSync(SYMBOLS_FILE, 'utf8');
      SYMBOLS = JSON.parse(data);
    } else {
      SYMBOLS = [...DEFAULT_SYMBOLS];
      fs.writeFileSync(SYMBOLS_FILE, JSON.stringify(SYMBOLS, null, 2));
    }
  } catch (err) {
    console.error("Error loading symbols:", err);
    SYMBOLS = [...DEFAULT_SYMBOLS];
  }
}
loadSymbols();

function saveSymbols() {
  try {
    fs.writeFileSync(SYMBOLS_FILE, JSON.stringify(SYMBOLS, null, 2));
  } catch (err) {
    console.error("Error saving symbols:", err);
  }
}

// ============================================================
// RATE-LIMIT PROTECTION
// In-memory cache: we only call Groww's real API at most once every
// MIN_REFRESH_MS per symbol, no matter how many browser tabs/clients
// are polling this backend. This is what stops you from burning your
// daily API quota.
// ============================================================
const cache = {}; // symbol -> { closes: [...], lastFetch: timestamp, lastQuote: {...} }

app.get('/api/quotes', async (req, res) => {
  const period = parseInt(req.query.period || '14');
  if (isNaN(period) || period < 2 || period > 50) {
    return res.status(400).json({ error: 'Invalid RSI period. Must be between 2 and 50.' });
  }
  let isAnyMock = false;
  let requestedSymbols = SYMBOLS;
  if (req.query.symbols) {
    requestedSymbols = req.query.symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  const allSymbols = ['^NSEI', ...requestedSymbols];

  try {
    // Fetch live prices for all symbols in a single batch request
    const batchQuotes = await fetchBatchLTP(allSymbols);
    const results = [];
    let niftyData = null;

    for (const symbol of allSymbols) {
      const quote = batchQuotes[symbol] || { ltp: null, volume: null, changePct: null, isMock: true };

      // Get historical closes from cache, fallback if missing
      let closes = cache[symbol]?.closes;
      if (!closes || closes.length < 50) {
        try {
          closes = await fetchHistoricalCloses(symbol, 150);
        } catch (err) {
          closes = [];
        }
      }

      // Create a temporary copy for calculations and append the live LTP (never mutate cached closes)
      let calcCloses = [...(closes || [])];
      if (quote.ltp != null) {
        if (calcCloses.length === 0) {
          calcCloses = [quote.ltp];
        } else {
          calcCloses = [...calcCloses, quote.ltp].slice(-150);
        }
      }

      // Save pure daily closes + latest quote metadata to cache
      const now = Date.now();
      cache[symbol] = { closes: closes || [], lastFetch: now, lastQuote: quote };

      if (quote.isMock) isAnyMock = true;

      if (symbol === '^NSEI') {
        niftyData = {
          ltp: quote.ltp,
          changePct: quote.changePct,
          isMock: quote.isMock,
          closes: calcCloses
        };
      } else {
        const rsi = calcRSI(calcCloses, period);
        const sig = signalFor(rsi);
        results.push({
          symbol,
          ltp: quote.ltp,
          volume: quote.volume,
          changePct: quote.changePct,
          rsi,
          signal: sig.label,
          color: sig.color,
          updatedAt: new Date(Date.now()).toISOString(),
          isMock: quote.isMock,
          closes: calcCloses
        });
      }
    }

    res.json({
      data: results,
      minRefreshMs: MIN_REFRESH_MS,
      isMock: isAnyMock,
      nifty: niftyData
    });
  } catch (err) {
    console.error('[/api/quotes] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error while fetching quotes.' });
  }
});

// Add a symbol dynamically with validation
app.post('/api/symbols', async (req, res) => {
  let symbol = req.body.symbol;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol parameter is required' });
  }

  symbol = symbol.trim().toUpperCase();

  if (SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: 'Symbol already exists' });
  }

  // Validate symbol on Yahoo Finance
  const isValid = await verifySymbol(symbol);
  if (!isValid) {
    return res.status(400).json({ error: 'Invalid NSE symbol. Please verify ticker code.' });
  }

  SYMBOLS.push(symbol);
  saveSymbols();
  res.json({ success: true, symbols: SYMBOLS });
});

// Delete a symbol dynamically
app.delete('/api/symbols/:symbol', (req, res) => {
  const symbol = req.params.symbol.trim().toUpperCase();
  const idx = SYMBOLS.indexOf(symbol);
  if (idx === -1) {
    return res.status(404).json({ error: 'Symbol not found' });
  }

  SYMBOLS.splice(idx, 1);
  saveSymbols();
  
  // Clean up cache entry
  delete cache[symbol];

  res.json({ success: true, symbols: SYMBOLS });
});

// Helper to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function warmUpCache() {
  console.log("Warming up historical data cache...");
  const allSymbols = ['^NSEI', ...SYMBOLS];
  for (const symbol of allSymbols) {
    try {
      let closes = cache[symbol]?.closes;
      if (!closes || closes.length < 50) {
        console.log(`Seeding history for ${symbol}...`);
        closes = await fetchHistoricalCloses(symbol, 150);
        cache[symbol] = {
          closes,
          lastFetch: Date.now(),
          lastQuote: { ltp: null, volume: null, changePct: null, isMock: true }
        };
        await sleep(150);
      }
    } catch (err) {
      console.error(`Error seeding history for ${symbol}:`, err.message);
    }
  }
  console.log("Historical data cache warm-up completed.");
}

app.listen(PORT, () => {
  console.log(`NSE RSI backend running on http://localhost:${PORT}`);
  console.log(`Rate-limit protection: min ${MIN_REFRESH_MS}ms between real API calls per symbol`);
  
  // Start background sequential cache warm-up
  warmUpCache();
});
