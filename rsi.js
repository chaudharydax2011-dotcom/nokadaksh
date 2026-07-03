// rsi.js
// True Wilder's RSI. RS = AvgGain / AvgLoss, RSI = 100 - (100 / (1 + RS))

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null; // not enough data yet

  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  if (changes.length < period) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // First RSI value uses simple average of first 'period' changes
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // Subsequent values use Wilder's smoothing technique
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    if (avgGain === 0) return 50; // Balanced/flat momentum
    return 100; // Direct gain momentum
  }

  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function signalFor(rsi) {
  if (rsi === null) return { label: 'N/A', color: '#7d93b2' };
  if (rsi > 70)    return { label: 'STRONG SELL', color: '#ef4444' };
  if (rsi > 65)    return { label: 'SELL',        color: '#f97316' };
  if (rsi >= 35)   return { label: 'HOLD',        color: '#eab308' };
  if (rsi >= 30)   return { label: 'BUY',         color: '#00ff66' };
  return             { label: 'STRONG BUY',  color: '#15803d' };
}

module.exports = { calcRSI, signalFor };
