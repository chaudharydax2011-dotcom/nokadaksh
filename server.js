// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchLTP, fetchHistoricalCloses, verifySymbol } = require('./growwClient');
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

async function getSymbolData(symbol) {
  const now = Date.now();
  const entry = cache[symbol];

  if (entry && (now - entry.lastFetch) < MIN_REFRESH_MS) {
    return entry; // serve cached data, don't hit Groww again yet
  }

  try {
    // Seed historical closes only once (or rarely) since they barely change intraday
    let closes = entry?.closes;
    if (!closes || closes.length < 15) {
      closes = await fetchHistoricalCloses(symbol, 30);
    }

    const quote = await fetchLTP(symbol);
    if (quote.ltp != null) {
      // Create a fresh array or update the existing one
      if (!closes || closes.length === 0) {
        closes = [quote.ltp];
      } else {
        closes = [...closes, quote.ltp].slice(-100); // keep last 100 points
      }
    }

    cache[symbol] = { closes, lastFetch: now, lastQuote: quote };
    return cache[symbol];
  } catch (err) {
    console.error(`[${symbol}] fetch error:`, err.message);
    // If it fails, cache a temporary mock state to avoid hammering the endpoint
    const fallbackEntry = entry || {
      closes: [],
      lastFetch: now,
      lastQuote: { ltp: null, volume: null, changePct: null, isMock: true }
    };
    cache[symbol] = fallbackEntry;
    return fallbackEntry;
  }
}

app.get('/api/quotes', async (req, res) => {
  const period = parseInt(req.query.period || '14');
  let isAnyMock = false;

  // Fetch Nifty 50 Index
  let niftyData = null;
  try {
    const niftyFetch = await getSymbolData('^NSEI');
    niftyData = {
      ltp: niftyFetch.lastQuote?.ltp ?? null,
      changePct: niftyFetch.lastQuote?.changePct ?? null,
      isMock: niftyFetch.lastQuote?.isMock ?? false,
      closes: niftyFetch.closes ?? []
    };
    if (niftyFetch.lastQuote?.isMock) {
      isAnyMock = true;
    }
  } catch (err) {
    console.error('Nifty 50 fetch error:', err.message);
  }

  const results = await Promise.all(
    SYMBOLS.map(async (symbol) => {
      const data = await getSymbolData(symbol);
      const rsi = calcRSI(data.closes, period);
      const sig = signalFor(rsi);
      if (data.lastQuote?.isMock) {
        isAnyMock = true;
      }
      return {
        symbol,
        ltp: data.lastQuote?.ltp ?? null,
        volume: data.lastQuote?.volume ?? null,
        changePct: data.lastQuote?.changePct ?? null,
        rsi,
        signal: sig.label,
        color: sig.color,
        updatedAt: new Date(data.lastFetch).toISOString(),
        isMock: data.lastQuote?.isMock ?? false,
        closes: data.closes ?? []
      };
    })
  );

  res.json({
    data: results,
    minRefreshMs: MIN_REFRESH_MS,
    isMock: isAnyMock,
    nifty: niftyData
  });
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

// Serve frontend at the root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`NSE RSI backend running on http://localhost:${PORT}`);
  console.log(`Rate-limit protection: min ${MIN_REFRESH_MS}ms between real API calls per symbol`);
});
