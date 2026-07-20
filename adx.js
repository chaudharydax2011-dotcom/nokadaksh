// adx.js
// ============================================================
// 100% Accurate Wilder's 14-period ADX calculation
// ============================================================

/**
 * Calculates Wilder's 14-period ADX
 * @param {Array} highs
 * @param {Array} lows
 * @param {Array} closes
 * @param {number} period Defaults to 14
 * @returns {number|null} ADX value
 */
function calcADX(highs, lows, closes, period = 14) {
  if (!highs || !lows || !closes) return null;
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period * 2 + 2) return null;

  const trArr = [];
  const pDMArr = [];
  const mDMArr = [];

  for (let i = 1; i < len; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];

    // True Range (TR)
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trArr.push(tr);

    // Directional Movement (+DM and -DM)
    pDMArr.push(up > down && up > 0 ? up : 0);
    mDMArr.push(down > up && down > 0 ? down : 0);
  }

  if (trArr.length < period) return null;

  // Initial TR, +DM, -DM sums
  let smTR = trArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smP = pDMArr.slice(0, period).reduce((a, b) => a + b, 0);
  let smM = mDMArr.slice(0, period).reduce((a, b) => a + b, 0);

  const toDX = (tr, p, m) => {
    if (tr === 0) return 0;
    const pdi = (100 * p) / tr;
    const mdi = (100 * m) / tr;
    const diff = Math.abs(pdi - mdi);
    const sum = pdi + mdi;
    return sum === 0 ? 0 : (100 * diff) / sum;
  };

  const dxArr = [];
  dxArr.push(toDX(smTR, smP, smM));

  // Wilder's smoothing for subsequent periods
  for (let i = period; i < trArr.length; i++) {
    smTR = smTR - smTR / period + trArr[i];
    smP = smP - smP / period + pDMArr[i];
    smM = smM - smM / period + mDMArr[i];
    dxArr.push(toDX(smTR, smP, smM));
  }

  if (dxArr.length < period) return null;

  // Initial ADX is the average of first 'period' DX values
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder's smoothing for subsequent ADX values
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }

  return +adx.toFixed(2);
}

module.exports = { calcADX };
