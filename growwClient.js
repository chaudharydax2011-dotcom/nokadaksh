// growwClient.js
// ============================================================
// Yahoo Finance API integration (free, real-time, no API key required)
// with a robust simulation fallback mode.
// ============================================================

const fetch = require('node-fetch');

const isMockMode = process.env.MOCK_MODE === 'true';

// Dynamic base prices for ETFs to make mock data look realistic in simulation mode
const BASE_PRICES = {
  "MAHKTECH": 150.00,
  "NIFTYBEES": 270.00,
  "CPSEETF": 75.00,
  "PHARMABEES": 19.50,
  "HNGSNGBEES": 28.00,
  "MON100": 130.00,
  "JUNIORBEES": 550.00,
  "ITBEES": 42.00,
  "HDFCSML250": 115.00,
  "PSUBNKBEES": 70.00,
  "FMCGIETF": 410.00,
  "BANKBEES": 520.00,
  "MASPTOP50": 38.00,
  "MOM100": 16.00,
  "MOM50": 18.00,
  "GOLDBEES": 63.00,
  "TNIDETF": 15.00,
  "SENSEXETF": 820.00,
  "SILVERBEES": 82.00,
  "MAKEINDIA": 25.00,
  "NIFTYQLITY": 210.00,
  "NV20IETF": 125.00,
  "SBIETFQLTY": 210.00
};

/**
 * Generate simulated candles using a pseudo-random walk (for simulation mode)
 */
function generateSimulatedCandles(symbol, days = 30) {
  const basePrice = BASE_PRICES[symbol] || 100.00;
  const closes = [];
  let current = basePrice;
  
  let seed = 0;
  for (let char of symbol) {
    seed += char.charCodeAt(0);
  }
  
  function pseudoRandom() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  // Assign deterministic drift profile based on symbol hash
  const profileHash = seed % 5;
  let drift = 0.001; // default HOLD drift
  
  if (profileHash === 0) {
    drift = -0.015; // decline -> STRONG BUY
  } else if (profileHash === 1) {
    drift = -0.005; // gentle decline -> BUY
  } else if (profileHash === 2) {
    drift = 0.001;  // range-bound -> HOLD
  } else if (profileHash === 3) {
    drift = 0.006;  // gentle rise -> SELL
  } else {
    drift = 0.016;  // rise -> STRONG SELL
  }

  for (let i = 0; i < days; i++) {
    const change = (pseudoRandom() - 0.5) * 0.03 + drift;
    current = current * (1 + change);
    closes.push(+current.toFixed(2));
  }
  return closes;
}

/**
 * Get mock LTP data (for simulation mode)
 */
function getMockLTP(symbol) {
  const closes = generateSimulatedCandles(symbol, 30);
  const lastClose = closes[closes.length - 1];
  
  // Intraday fluctuation between -0.6% and +0.6%
  const fluctuation = (Math.random() - 0.5) * 0.012;
  const ltp = +(lastClose * (1 + fluctuation)).toFixed(2);
  const changePct = +(fluctuation * 100).toFixed(2);
  const volume = Math.floor(25000 + Math.random() * 850000);
  
  return {
    symbol,
    ltp,
    volume,
    changePct,
    isMock: true
  };
}

/**
 * Fetch latest traded price (LTP) for a symbol using Yahoo Finance.
 * Falls back to simulation if the request fails.
 */
async function fetchLTP(symbol) {
  if (isMockMode) {
    return getMockLTP(symbol);
  }
  
  try {
    const ticker = symbol.startsWith('^') ? symbol : `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=2d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 5000
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.chart || !json.chart.result || json.chart.result.length === 0) {
      throw new Error('Invalid Yahoo Finance response structure');
    }
    const meta = json.chart.result[0].meta;
    const ltp = meta.regularMarketPrice;
    const volume = meta.regularMarketVolume || null;
    const prevClose = meta.chartPreviousClose || ltp;
    const changePct = prevClose ? +(((ltp - prevClose) / prevClose) * 100).toFixed(2) : 0;
    
    return {
      symbol,
      ltp,
      volume,
      changePct,
      isMock: false
    };
  } catch (err) {
    console.warn(`[YahooFinance] LTP fetch failed for ${symbol}. Falling back to simulation: ${err.message}`);
    return getMockLTP(symbol);
  }
}

/**
 * Fetch historical daily closes using Yahoo Finance.
 * Falls back to simulation if the request fails.
 */
async function fetchHistoricalCloses(symbol, days = 30) {
  if (isMockMode) {
    return generateSimulatedCandles(symbol, days);
  }
  
  try {
    const ticker = symbol.startsWith('^') ? symbol : `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${days}d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 5000
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (!json.chart || !json.chart.result || json.chart.result.length === 0) {
      throw new Error('Invalid Yahoo Finance response structure');
    }
    const quotes = json.chart.result[0].indicators.quote[0];
    if (!quotes || !quotes.close) {
      throw new Error('No historical close array found');
    }
    const closes = quotes.close.filter(c => c !== null && c !== undefined);
    if (closes.length === 0) {
      throw new Error('Empty historical close data');
    }
    return closes;
  } catch (err) {
    console.warn(`[YahooFinance] Historical closes fetch failed for ${symbol}. Falling back to simulation: ${err.message}`);
    return generateSimulatedCandles(symbol, days);
  }
}

/**
 * Verify if a symbol is valid on Yahoo Finance by attempting to fetch its chart data.
 */
async function verifySymbol(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?range=1d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 5000
    });
    return res.status === 200;
  } catch (err) {
    console.warn(`[YahooFinance] Symbol verification failed for ${symbol}: ${err.message}`);
    return false;
  }
}

async function fetchIndexCandles(symbol, days = 30) {
  if (isMockMode) {
    const mockCloses = generateSimulatedCandles(symbol, days);
    return mockCloses.map((close, i) => {
      const open = i > 0 ? mockCloses[i-1] : close * 0.99;
      const high = Math.max(open, close) * (1 + Math.random() * 0.008);
      const low = Math.min(open, close) * (1 - Math.random() * 0.008);
      const volume = Math.floor(150000 + Math.random() * 800000);
      return {
        date: new Date(Date.now() - (days - i) * 24 * 3600 * 1000).toLocaleDateString('en-GB'),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume
      };
    });
  }

  try {
    const ticker = symbol.startsWith('^') ? symbol : `${symbol}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${days}d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 5000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) throw new Error('No result');
    
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && opens[i] != null && highs[i] != null && lows[i] != null) {
        const date = new Date(timestamps[i] * 1000).toLocaleDateString('en-GB');
        candles.push({
          date,
          open: +opens[i].toFixed(2),
          high: +highs[i].toFixed(2),
          low: +lows[i].toFixed(2),
          close: +closes[i].toFixed(2),
          volume: volumes[i] || 0
        });
      }
    }
    return candles;
  } catch (err) {
    console.warn(`[YahooFinance] Index candles fetch failed for ${symbol}: ${err.message}`);
    const mockCloses = generateSimulatedCandles(symbol, days);
    return mockCloses.map((close, i) => {
      const open = i > 0 ? mockCloses[i-1] : close * 0.99;
      const high = Math.max(open, close) * (1 + Math.random() * 0.008);
      const low = Math.min(open, close) * (1 - Math.random() * 0.008);
      const volume = Math.floor(150000 + Math.random() * 800000);
      return {
        date: new Date(Date.now() - (days - i) * 24 * 3600 * 1000).toLocaleDateString('en-GB'),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume
      };
    });
  }
}

module.exports = { fetchLTP, fetchHistoricalCloses, verifySymbol, fetchIndexCandles };
