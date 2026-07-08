// indicators.js
// ============================================================
// Industry-standard technical indicator calculations:
// EMA, MACD (12/26/9), ADX (Wilder 14-period), Score/100
// ============================================================

/**
 * Full EMA series. Seed = SMA of first period values, then EMA formula.
 * k = 2/(period+1). Returns array length = closes.length - period + 1
 */
function calcEMASeries(closes, period) {
  if (!closes || closes.length < period) return [];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [ema];
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/** Most recent EMA value for a given period */
function calcEMA(closes, period) {
  const series = calcEMASeries(closes, period);
  if (series.length === 0) return null;
  return +series[series.length - 1].toFixed(4);
}

/**
 * MACD (12/26/9)
 * MACD Line  = EMA12 - EMA26
 * Signal     = EMA9 of MACD Line
 * Histogram  = MACD - Signal
 * Needs >= 35 candles
 * Returns: { macd, signal, histogram, trend, crossover }
 */
function calcMACD(closes) {
  if (!closes || closes.length < 35) return null;
  const ema12 = calcEMASeries(closes, 12);
  const ema26 = calcEMASeries(closes, 26);
  const offset = ema12.length - ema26.length; // = 14
  const macdLine = ema26.map((e26, i) => ema12[i + offset] - e26);
  if (macdLine.length < 9) return null;
  const sigSeries = calcEMASeries(macdLine, 9);
  if (sigSeries.length === 0) return null;
  const lastMACD = macdLine[macdLine.length - 1];
  const lastSig  = sigSeries[sigSeries.length - 1];
  const hist     = lastMACD - lastSig;
  let crossover  = null;
  if (macdLine.length >= 2 && sigSeries.length >= 2) {
    const prevMACD = macdLine[macdLine.length - 2];
    const prevSig  = sigSeries[sigSeries.length - 2];
    if (prevMACD <= prevSig && lastMACD > lastSig) crossover = 'BULLISH_CROSS';
    if (prevMACD >= prevSig && lastMACD < lastSig) crossover = 'BEARISH_CROSS';
  }
  return {
    macd:      +lastMACD.toFixed(4),
    signal:    +lastSig.toFixed(4),
    histogram: +hist.toFixed(4),
    trend:     lastMACD > lastSig ? 'BULLISH' : 'BEARISH',
    crossover
  };
}

/**
 * ADX — Average Directional Index (Wilder 14-period)
 * ACCURACY NOTES:
 * - Only uses COMPLETED daily bars (no incomplete intraday bar)
 * - Wilder initial smooth = simple SUM of first period TR/DM values
 * - ADX seeded as SMA of first 'period' DX values (not first DX value alone)
 * - Needs >= period*2 completed bars for reliable ADX
 */
function calcADX(highs, lows, closes, period) {
  if (period === undefined) period = 14;
  if (!highs || !lows || !closes) return null;
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period * 2 + 2) return null;

  const trArr = [], pDMArr = [], mDMArr = [];
  for (let i = 1; i < len; i++) {
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    trArr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1])
    ));
    // +DM: only when upward move strictly greater than downward move
    pDMArr.push(up > down && up > 0 ? up : 0);
    // -DM: only when downward move strictly greater than upward move
    mDMArr.push(down > up && down > 0 ? down : 0);
  }
  if (trArr.length < period * 2) return null;

  // Wilder initial smooth = sum of first 'period' values
  let smTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smP  = pDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smM  = mDMArr.slice(0, period).reduce((a, b) => a + b, 0);

  const toDX = (tr, p, m) => {
    if (tr === 0) return 0;
    const pdi = 100 * p / tr;
    const mdi = 100 * m / tr;
    const s   = pdi + mdi;
    return s === 0 ? 0 : 100 * Math.abs(pdi - mdi) / s;
  };

  // Collect DX values for each subsequent bar
  const dxArr = [];
  for (let i = period; i < trArr.length; i++) {
    smTR = smTR - smTR / period + trArr[i];
    smP  = smP  - smP  / period + pDMArr[i];
    smM  = smM  - smM  / period + mDMArr[i];
    dxArr.push(toDX(smTR, smP, smM));
  }
  if (dxArr.length < period) return null;

  // ADX seed = SMA of first 'period' DX values (proper Wilder initialization)
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }

  const pDI = smTR > 0 ? +(100 * smP / smTR).toFixed(2) : 0;
  const mDI = smTR > 0 ? +(100 * smM / smTR).toFixed(2) : 0;
  adx = +adx.toFixed(2);
  const diSpread = Math.abs(pDI - mDI); // how decisively one DI leads the other

  let strength;
  if      (adx < 20) strength = 'WEAK';
  else if (adx < 25) strength = 'DEVELOPING';
  else if (adx < 40) strength = 'STRONG';
  else               strength = 'VERY STRONG';

  return {
    adx,
    plusDI:   pDI,
    minusDI:  mDI,
    diSpread: +diSpread.toFixed(2),
    strength,
    direction: pDI >= mDI ? 'BULLISH' : 'BEARISH'
  };
}

/**
 * Composite Score /100 — accurate multi-indicator weighted system
 *
 * Weights: RSI=20, MACD=20 (with histogram strength), EMA=25, ADX=20 (with DI spread), Volume=15
 * BONUS: RSI + MACD confluence = up to +5 extra pts (capped at 100)
 */
function calcScore(opts) {
  const { rsi, macd, ema20, ema50, adx: adxData, ltp, lastVolume, avgVolume } = opts;
  let score = 0;

  // ── RSI: 20pts ──
  // Linear scoring based on distance from neutral (50)
  if (rsi !== null && rsi !== undefined) {
    if      (rsi < 20)  score += 20;
    else if (rsi < 30)  score += 17 + (30 - rsi) / 10 * 3;
    else if (rsi < 35)  score += 13 + (35 - rsi) / 5  * 4;
    else if (rsi < 50)  score += 8  + (50 - rsi) / 15 * 5;
    else if (rsi < 65)  score += 4  + (65 - rsi) / 15 * 4;
    else if (rsi < 70)  score += 2  + (70 - rsi) / 5  * 2;
    else if (rsi < 80)  score += Math.max(0, 2 - (rsi - 70) / 10 * 2);
    else                score += 0;
  }

  // ── MACD: 20pts — trend + crossover + histogram magnitude ──
  if (macd) {
    const histAbs = Math.abs(macd.histogram);
    const histMag = Math.abs(macd.macd); // normalize histogram vs MACD value
    const histRatio = histMag > 0 ? Math.min(histAbs / histMag, 1) : 0;
    if (macd.trend === 'BULLISH') {
      // Base: 12-16 pts, crossover bonus: +4, histogram strength: +0 to +2
      let pts = macd.crossover === 'BULLISH_CROSS' ? 17 : 13;
      pts += histRatio * 3; // strong histogram = higher confidence
      score += Math.min(20, pts);
    } else {
      let pts = macd.crossover === 'BEARISH_CROSS' ? 0 : 4;
      pts += (1 - histRatio) * 2; // weak bearish histogram = slightly less bearish
      score += Math.min(8, pts);
    }
  } else {
    score += 8; // neutral — insufficient data
  }

  // ── EMA Position: 25pts ──
  // Price vs EMA20 vs EMA50 — all three relationships matter
  if (ltp != null && ema20 != null && ema50 != null) {
    const aboveEMA20      = ltp   > ema20;
    const aboveEMA50      = ltp   > ema50;
    const ema20AboveEMA50 = ema20 > ema50;

    // Pct gap between price and EMAs for proportional scoring
    const gapEMA20 = Math.abs(ltp - ema20) / ema20;
    const gapEMA50 = Math.abs(ltp - ema50) / ema50;

    if (aboveEMA20 && ema20AboveEMA50 && aboveEMA50) {
      // Strong uptrend: P > EMA20 > EMA50 — scale by how far above
      score += Math.min(25, 20 + gapEMA20 * 50);
    } else if (aboveEMA20 && !ema20AboveEMA50) {
      // Short-term recovery above EMA20 but below EMA50 crossover
      score += Math.min(18, 14 + gapEMA20 * 20);
    } else if (!aboveEMA20 && aboveEMA50) {
      // Pullback in uptrend: below EMA20 but above EMA50
      score += 9;
    } else if (!aboveEMA20 && !aboveEMA50 && !ema20AboveEMA50) {
      // Full downtrend: P < EMA20 < EMA50
      score += Math.max(0, 3 - gapEMA50 * 20);
    } else {
      score += 5;
    }
  } else {
    score += 10; // neutral
  }

  // ── ADX: 15pts — pure strength-based (user spec) ──
  // < 20 = 0, 20-25 = +5, 25-35 = +10, > 35 = +15
  if (adxData) {
    if      (adxData.adx > 35)  score += 15;
    else if (adxData.adx >= 25) score += 10;
    else if (adxData.adx >= 20) score += 5;
    else                        score += 0;
  }
  // no neutral fallback — ADX < 20 adds nothing (weak/ranging market)

  // ── Volume: 15pts ──
  if (lastVolume && avgVolume && avgVolume > 0) {
    const r = lastVolume / avgVolume;
    if      (r >= 3.0) score += 15;
    else if (r >= 2.0) score += 12;
    else if (r >= 1.5) score += 9;
    else if (r >= 1.0) score += 6;
    else if (r >= 0.5) score += 3;
    else               score += 1;
  } else {
    score += 7; // neutral
  }

  // ── Confluence Bonus: RSI + MACD both bullish/bearish = +3pts ──
  if (rsi !== null && macd) {
    const rsiBull  = rsi < 50;
    const macdBull = macd.trend === 'BULLISH';
    const rsiBear  = rsi > 55;
    const macdBear = macd.trend === 'BEARISH';
    if      (rsiBull && macdBull) score += 3; // both agree bullish
    else if (rsiBear && macdBear) score -= 3; // both agree bearish
  }

  score = Math.min(100, Math.max(0, Math.round(score)));
  let label, color;
  if      (score >= 75) { label = 'STRONG BUY';  color = '#15803d'; }
  else if (score >= 55) { label = 'BUY';          color = '#00ff66'; }
  else if (score >= 40) { label = 'HOLD';         color = '#eab308'; }
  else if (score >= 25) { label = 'SELL';         color = '#f97316'; }
  else                  { label = 'STRONG SELL';  color = '#ef4444'; }
  return { score, label, color };
}

module.exports = { calcEMA, calcEMASeries, calcMACD, calcADX, calcScore };
