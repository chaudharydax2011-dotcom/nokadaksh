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
 * Needs parallel highs[], lows[], closes[] arrays, >= 29 candles
 * TR  = max(H-L, |H-PrevC|, |L-PrevC|)
 * +DM = upMove if upMove > downMove and upMove > 0, else 0
 * -DM = downMove if downMove > upMove and downMove > 0, else 0
 * Wilder Smooth: S(n) = S(n-1) - S(n-1)/period + val(n)
 * +DI = 100 * SmPlusDM / SmTR
 * -DI = 100 * SmMinusDM / SmTR
 * DX  = 100 * |+DI - -DI| / (+DI + -DI)
 * ADX = Wilder smooth of DX
 * Returns: { adx, plusDI, minusDI, strength, direction }
 */
function calcADX(highs, lows, closes, period) {
  if (period === undefined) period = 14;
  if (!highs || !lows || !closes) return null;
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period * 2 + 1) return null;
  const trArr = [], pDMArr = [], mDMArr = [];
  for (let i = 1; i < len; i++) {
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    trArr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
    pDMArr.push(up > down && up > 0 ? up : 0);
    mDMArr.push(down > up && down > 0 ? down : 0);
  }
  if (trArr.length < period) return null;
  let smTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smP  = pDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smM  = mDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  const toDX = (tr, p, m) => {
    if (tr === 0) return 0;
    const pdi = 100 * p / tr, mdi = 100 * m / tr;
    const s = pdi + mdi;
    return s === 0 ? 0 : 100 * Math.abs(pdi - mdi) / s;
  };
  const dxArr = [toDX(smTR, smP, smM)];
  for (let i = period; i < trArr.length; i++) {
    smTR = smTR - smTR / period + trArr[i];
    smP  = smP  - smP  / period + pDMArr[i];
    smM  = smM  - smM  / period + mDMArr[i];
    dxArr.push(toDX(smTR, smP, smM));
  }
  if (dxArr.length < period) return null;
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxArr.length; i++) adx = (adx * (period - 1) + dxArr[i]) / period;
  const pDI = smTR > 0 ? +(100 * smP / smTR).toFixed(2) : 0;
  const mDI = smTR > 0 ? +(100 * smM / smTR).toFixed(2) : 0;
  adx = +adx.toFixed(2);
  let strength;
  if      (adx < 20) strength = 'WEAK';
  else if (adx < 25) strength = 'DEVELOPING';
  else if (adx < 40) strength = 'STRONG';
  else               strength = 'VERY STRONG';
  return { adx, plusDI: pDI, minusDI: mDI, strength, direction: pDI >= mDI ? 'BULLISH' : 'BEARISH' };
}

/**
 * Composite Score /100
 * RSI=20pts, MACD=20pts, EMA position=25pts, ADX=20pts, Volume=15pts
 * Returns: { score, label, color }
 */
function calcScore(opts) {
  const { rsi, macd, ema20, ema50, adx: adxData, ltp, lastVolume, avgVolume } = opts;
  let score = 0;

  // RSI: 20pts
  if (rsi !== null && rsi !== undefined) {
    if      (rsi < 30)  score += 18 + (30 - rsi) / 30 * 2;
    else if (rsi < 35)  score += 12 + (35 - rsi) / 5  * 6;
    else if (rsi < 50)  score += 7  + (50 - rsi) / 15 * 5;
    else if (rsi < 65)  score += 3  + (65 - rsi) / 15 * 4;
    else if (rsi < 70)  score += 1  + (70 - rsi) / 5  * 2;
    else                score += Math.max(0, 1 - (rsi - 70) / 10);
  }

  // MACD: 20pts
  if (macd) {
    if (macd.trend === 'BULLISH') score += macd.crossover === 'BULLISH_CROSS' ? 20 : 14;
    else                          score += macd.crossover === 'BEARISH_CROSS' ?  0 :  5;
  } else { score += 8; }

  // EMA: 25pts
  if (ltp != null && ema20 != null && ema50 != null) {
    if      (ltp > ema20 && ema20 > ema50)   score += 24;
    else if (ltp > ema20 && ema20 <= ema50)  score += 16;
    else if (ltp <= ema20 && ltp > ema50)    score += 9;
    else                                      score += 2;
  } else { score += 10; }

  // ADX: 20pts
  if (adxData) {
    const bull = adxData.direction === 'BULLISH';
    if      (adxData.adx >= 40) score += bull ? 20 : 0;
    else if (adxData.adx >= 25) score += bull ? 17 : 2;
    else if (adxData.adx >= 20) score += bull ? 13 : 5;
    else                        score += 8;
  } else { score += 8; }

  // Volume: 15pts
  if (lastVolume && avgVolume && avgVolume > 0) {
    const r = lastVolume / avgVolume;
    if      (r >= 3.0) score += 15;
    else if (r >= 2.0) score += 12;
    else if (r >= 1.5) score += 9;
    else if (r >= 1.0) score += 6;
    else if (r >= 0.5) score += 3;
    else               score += 1;
  } else { score += 7; }

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
