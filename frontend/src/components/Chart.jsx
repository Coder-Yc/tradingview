import { useEffect, useRef, useCallback } from 'react';
import { createChart, CrosshairMode, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import useDrawings, { hitTest } from '../hooks/useDrawings';
import DrawingPropsModal from './DrawingPropsModal';

const CHART_THEME = {
  layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
  grid:   { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#30363d' },
  timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
};

const FOOTPRINT_THRESHOLD = 52;

// Minimum price tick per symbol
// Format large numbers: 1234 → "1.2k", 12345 → "12k"
const fmtVol = (n) => {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const SYMBOL_TICK = {
  ES: 0.25,
  NQ: 0.25,  // NQ min tick is 0.25
  GC: 0.10,
  SI: 0.005,
  CL: 0.01,
  ZN: 0.015625,
  ZB: 0.03125,
};
// Default tick if symbol unknown
const DEFAULT_TICK = 0.1;
const getTick = (symbol) => SYMBOL_TICK[symbol] ?? DEFAULT_TICK;

// Legacy constant kept for backward compat with non-symbol-aware helpers
const TICK = DEFAULT_TICK;

// How many decimal places are needed to represent a tick value exactly.
// e.g. 0.25 → 2, 0.1 → 1, 0.015625 → 6, 1.0 → 0
const tickDecimals = (tick) => {
  const s = tick.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function aggregateLevels(levels, baseTick, effectiveTick) {
  if (effectiveTick <= baseTick) return levels;
  const decimals = Math.max(tickDecimals(baseTick), tickDecimals(effectiveTick));
  const merged = new Map();
  for (const [priceStr, { sell, buy, trades }] of levels) {
    const price   = parseFloat(priceStr);
    // Round to nearest effectiveTick to avoid floating-point drift
    const snapped = (Math.round(price / effectiveTick) * effectiveTick).toFixed(decimals);
    const prev    = merged.get(snapped) || { sell: 0, buy: 0, trades: 0 };
    merged.set(snapped, { sell: prev.sell + sell, buy: prev.buy + buy, trades: prev.trades + trades });
  }
  return merged;
}

function computeEffectiveTick(series, referencePrice, baseTick = DEFAULT_TICK) {
  const yT0 = series.priceToCoordinate(referencePrice);
  const yT1 = series.priceToCoordinate(referencePrice + baseTick);
  if (yT0 === null || yT1 === null) return baseTick;
  const pxPerTick = Math.abs(yT1 - yT0);
  for (const m of [1, 2, 5, 10, 25, 50, 100]) {
    if (pxPerTick * m >= 6) return baseTick * m;
  }
  return baseTick * 100;
}

// ── EMA ────────────────────────────────────────────────────────────────────────

function computeEMA(candles, period) {
  const result = [];
  if (candles.length < period) return result;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (i === period - 1) {
      ema = 0;
      for (let j = 0; j < period; j++) ema += candles[j].close;
      ema /= period;
    } else {
      ema = candles[i].close * k + ema * (1 - k);
    }
    result.push({ time: candles[i].time, value: ema });
  }
  return result;
}

function drawEMALine(ctx, chart, series, candles, period, color) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const pts = computeEMA(sorted, period);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  let started = false;
  for (const pt of pts) {
    if (!pt) { started = false; continue; }
    const x = chart.timeScale().timeToCoordinate(pt.time);
    const y = series.priceToCoordinate(pt.value);
    if (x === null || y === null) { started = false; continue; }
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── SMA ────────────────────────────────────────────────────────────────────────

function computeSMA(candles, period) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    result.push({ time: candles[i].time, value: sum / period });
  }
  return result;
}

function drawSMALine(ctx, chart, series, candles, period, color) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const pts = computeSMA(sorted, period);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); let started = false;
  for (const pt of pts) {
    if (!pt) { started = false; continue; }
    const x = chart.timeScale().timeToCoordinate(pt.time);
    const y = series.priceToCoordinate(pt.value);
    if (x === null || y === null) { started = false; continue; }
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── Bollinger Bands ────────────────────────────────────────────────────────────

function computeBollinger(candles, period, mult) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mid = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (candles[j].close - mid) ** 2;
    const std = Math.sqrt(variance / period);
    result.push({ time: candles[i].time, upper: mid + mult * std, lower: mid - mult * std, mid });
  }
  return result;
}

function drawBollingerBands(ctx, chart, series, candles, period, mult, color) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const pts = computeBollinger(sorted, period, mult);
  const upperXY = [], lowerXY = [], midXY = [];
  for (const pt of pts) {
    if (!pt) continue;
    const x  = chart.timeScale().timeToCoordinate(pt.time);
    const yu = series.priceToCoordinate(pt.upper);
    const yl = series.priceToCoordinate(pt.lower);
    const ym = series.priceToCoordinate(pt.mid);
    if (x === null || yu === null || yl === null || ym === null) continue;
    upperXY.push({ x, y: yu }); lowerXY.push({ x, y: yl }); midXY.push({ x, y: ym });
  }
  if (upperXY.length < 2) return;
  // Filled band
  ctx.beginPath();
  ctx.moveTo(upperXY[0].x, upperXY[0].y);
  for (const p of upperXY) ctx.lineTo(p.x, p.y);
  for (let i = lowerXY.length - 1; i >= 0; i--) ctx.lineTo(lowerXY[i].x, lowerXY[i].y);
  ctx.closePath();
  ctx.fillStyle = `${color}1a`; ctx.fill();
  // Band lines
  const drawPts = (arr) => {
    ctx.beginPath(); ctx.moveTo(arr[0].x, arr[0].y);
    for (const p of arr.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
  drawPts(upperXY); drawPts(lowerXY);
  // Mid dashed
  ctx.lineWidth = 0.7; ctx.setLineDash([4, 4]);
  drawPts(midXY);
  ctx.setLineDash([]);
}

// ── VWAP ───────────────────────────────────────────────────────────────────────

function drawVWAP(ctx, chart, series, candles, color) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  let cumPV = 0, cumV = 0, lastDay = -1;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath();
  let started = false;
  for (const c of sorted) {
    const day = Math.floor(c.time / 86400);
    if (day !== lastDay) { cumPV = 0; cumV = 0; lastDay = day; started = false; }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = (c.buyVolume || 0) + (c.sellVolume || 0) || 1;
    cumPV += typical * vol; cumV += vol;
    const vwap = cumPV / cumV;
    const x = chart.timeScale().timeToCoordinate(c.time);
    const y = series.priceToCoordinate(vwap);
    if (x === null || y === null) { started = false; continue; }
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── CVD Line ───────────────────────────────────────────────────────────────────

function drawCVDLine(ctx, chart, series, candles, color, H) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  let cum = 0;
  const pts = sorted.map((c) => { cum += (c.buyVolume || 0) - (c.sellVolume || 0); return { time: c.time, v: cum }; });
  const vals = pts.map((p) => p.v);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const cvdTop = H * 0.86, cvdH = H * 0.11;
  // Background
  ctx.fillStyle = 'rgba(13,17,23,0.55)';
  ctx.fillRect(0, cvdTop - 2, ctx.canvas.width / (window.devicePixelRatio || 1), cvdH + 4);
  // Zero line
  const zeroY = cvdTop + cvdH - ((0 - minV) / range) * cvdH;
  ctx.strokeStyle = 'rgba(100,110,120,0.4)'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(ctx.canvas.width / (window.devicePixelRatio||1), zeroY); ctx.stroke();
  ctx.setLineDash([]);
  // CVD line
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.beginPath(); let started = false;
  for (const pt of pts) {
    const x = chart.timeScale().timeToCoordinate(pt.time);
    if (x === null) { started = false; continue; }
    const y = cvdTop + cvdH - ((pt.v - minV) / range) * cvdH;
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Label
  ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(100,110,120,0.7)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('CVD', 4, cvdTop);
}

// ── Fair Value Gap (FVG) ───────────────────────────────────────────────────────

function drawFVGs(ctx, chart, series, candles, minGap) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const canvasW = ctx.canvas.width / (window.devicePixelRatio || 1);
  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = sorted[i - 1], next = sorted[i + 1];
    // Bullish FVG
    if (next.low - prev.high >= minGap) {
      let filled = false;
      for (let j = i + 2; j < sorted.length; j++) {
        if (sorted[j].low <= next.low && sorted[j].high >= prev.high) { filled = true; break; }
      }
      if (!filled) {
        const x1 = chart.timeScale().timeToCoordinate(sorted[i].time);
        const y1 = series.priceToCoordinate(prev.high), y2 = series.priceToCoordinate(next.low);
        if (x1 !== null && y1 !== null && y2 !== null) {
          const yT = Math.min(y1, y2), h = Math.abs(y2 - y1);
          ctx.fillStyle = 'rgba(38,166,65,0.10)'; ctx.fillRect(x1, yT, canvasW - x1, h);
          ctx.strokeStyle = 'rgba(38,166,65,0.35)'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x1, yT); ctx.lineTo(canvasW, yT); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1, yT + h); ctx.lineTo(canvasW, yT + h); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    // Bearish FVG
    if (prev.low - next.high >= minGap) {
      let filled = false;
      for (let j = i + 2; j < sorted.length; j++) {
        if (sorted[j].low <= prev.low && sorted[j].high >= next.high) { filled = true; break; }
      }
      if (!filled) {
        const x1 = chart.timeScale().timeToCoordinate(sorted[i].time);
        const y1 = series.priceToCoordinate(next.high), y2 = series.priceToCoordinate(prev.low);
        if (x1 !== null && y1 !== null && y2 !== null) {
          const yT = Math.min(y1, y2), h = Math.abs(y2 - y1);
          ctx.fillStyle = 'rgba(248,81,73,0.10)'; ctx.fillRect(x1, yT, canvasW - x1, h);
          ctx.strokeStyle = 'rgba(248,81,73,0.35)'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(x1, yT); ctx.lineTo(canvasW, yT); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x1, yT + h); ctx.lineTo(canvasW, yT + h); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
}

// ── Inside Bar ─────────────────────────────────────────────────────────────────

function drawInsideBars(ctx, chart, series, candles, startIdx, endIdx) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  for (let i = Math.max(1, startIdx); i <= Math.min(sorted.length - 1, endIdx); i++) {
    const prev = sorted[i - 1], curr = sorted[i];
    if (curr.high <= prev.high && curr.low >= prev.low) {
      const x = chart.timeScale().timeToCoordinate(curr.time);
      const y = series.priceToCoordinate(curr.high);
      if (x !== null && y !== null) {
        ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(150,160,200,0.8)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('IB', x, y - 4);
      }
    }
  }
}

// ── Stacked Imbalance ──────────────────────────────────────────────────────────

function drawStackedImbalance(ctx, chart, series, candles, footprintRef, effectiveTick, params, startIdx, endIdx, baseTick = DEFAULT_TICK) {
  const { threshold = 3, stackCount = 3 } = params || {};
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  for (let i = startIdx; i <= endIdx; i++) {
    const c = sorted[i]; if (!c) continue;
    const fp = footprintRef.current.get(c.time); if (!fp) continue;
    const agg = aggregateLevels(fp.levels, baseTick, effectiveTick);
    const entries = [...agg.entries()].map(([pk, v]) => ({ price: parseFloat(pk), ...v })).sort((a, b) => a.price - b.price);
    // Stacked buy imbalances
    let buyRun = 0;
    for (let j = 0; j < entries.length; j++) {
      const { buy, sell } = entries[j];
      buyRun = (sell > 0 && buy / sell >= threshold) ? buyRun + 1 : 0;
      if (buyRun >= stackCount) {
        const p1 = entries[j - stackCount + 1].price, p2 = entries[j].price + effectiveTick;
        const x = chart.timeScale().timeToCoordinate(c.time);
        const y1 = series.priceToCoordinate(p1), y2 = series.priceToCoordinate(p2);
        if (x !== null && y1 !== null && y2 !== null) {
          ctx.fillStyle = 'rgba(38,166,65,0.35)'; ctx.fillRect(x + 2, Math.min(y1,y2), 4, Math.abs(y2-y1));
        }
      }
    }
    // Stacked sell imbalances
    let sellRun = 0;
    for (let j = 0; j < entries.length; j++) {
      const { buy, sell } = entries[j];
      sellRun = (buy > 0 && sell / buy >= threshold) ? sellRun + 1 : 0;
      if (sellRun >= stackCount) {
        const p1 = entries[j - stackCount + 1].price, p2 = entries[j].price + effectiveTick;
        const x = chart.timeScale().timeToCoordinate(c.time);
        const y1 = series.priceToCoordinate(p1), y2 = series.priceToCoordinate(p2);
        if (x !== null && y1 !== null && y2 !== null) {
          ctx.fillStyle = 'rgba(248,81,73,0.35)'; ctx.fillRect(x - 6, Math.min(y1,y2), 4, Math.abs(y2-y1));
        }
      }
    }
  }
}

// ── Session VP ─────────────────────────────────────────────────────────────────

function drawSessionVP(ctx, chart, series, candles, footprintRef, effectiveTick, logRange, baseTick = DEFAULT_TICK) {
  if (!logRange) return;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const sessions = new Map();
  for (const c of sorted) {
    const key = Math.floor(c.time / 86400);
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(c);
  }
  const si = Math.max(0, Math.floor(logRange.from) - 1);
  const ei = Math.min(sorted.length - 1, Math.ceil(logRange.to) + 1);
  const visibleDays = new Set(sorted.slice(si, ei + 1).map((c) => Math.floor(c.time / 86400)));
  for (const [dayKey, list] of sessions) {
    if (!visibleDays.has(dayKey)) continue;
    const vpMap = new Map();
    for (const c of list) {
      const fp = footprintRef.current.get(c.time); if (!fp) continue;
      const agg = aggregateLevels(fp.levels, baseTick, effectiveTick);
      for (const [pk, { buy, sell }] of agg) {
        const prev = vpMap.get(pk) || { buy: 0, sell: 0 };
        vpMap.set(pk, { buy: prev.buy + buy, sell: prev.sell + sell });
      }
    }
    if (!vpMap.size) continue;
    const lastC = list.at(-1);
    const xRight = chart.timeScale().timeToCoordinate(lastC.time); if (xRight === null) continue;
    const va = computeValueArea(vpMap);
    const maxVol = Math.max(1, ...[...vpMap.values()].map((v) => v.buy + v.sell));
    const maxBarW = 55;
    // Value area
    if (va.vah !== null && va.val !== null) {
      const vahY = series.priceToCoordinate(va.vah), valY = series.priceToCoordinate(va.val);
      if (vahY !== null && valY !== null) {
        ctx.fillStyle = 'rgba(200,140,60,0.07)';
        ctx.fillRect(xRight - maxBarW, Math.min(vahY, valY), maxBarW, Math.abs(valY - vahY));
      }
    }
    for (const [pk, { buy, sell }] of vpMap) {
      const price = parseFloat(pk); const y = series.priceToCoordinate(price); if (y === null) continue;
      const totalVol = buy + sell;
      const barW = Math.max(1, Math.floor((totalVol / maxVol) * maxBarW));
      const yNext = series.priceToCoordinate(price - effectiveTick);
      const rowH = yNext !== null ? Math.max(1, Math.abs(yNext - y) - 0.5) : 4;
      const rowTop = y - rowH / 2;
      ctx.fillStyle = 'rgba(80,90,100,0.22)'; ctx.fillRect(xRight - barW, rowTop, barW, rowH);
      if (va.poc !== null && Math.abs(price - va.poc) < effectiveTick * 0.5) {
        ctx.strokeStyle = 'rgba(240,200,50,0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(xRight - barW + 0.5, rowTop + 0.5, barW - 1, Math.max(1, rowH - 1));
      }
    }
    // Session boundary dashed line
    const xLeft = chart.timeScale().timeToCoordinate(list[0].time);
    if (xLeft !== null) {
      ctx.strokeStyle = 'rgba(60,70,80,0.5)'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
      const canvasH = ctx.canvas.height / (window.devicePixelRatio || 1);
      ctx.beginPath(); ctx.moveTo(xLeft, 0); ctx.lineTo(xLeft, canvasH); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// ── Key Levels ─────────────────────────────────────────────────────────────────

function drawKeyLevels(ctx, chart, series, candles, footprintRef, effectiveTick, lookback, W, baseTick = DEFAULT_TICK) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const recent = sorted.slice(-Math.max(lookback, 20));
  const vpMap = new Map();
  for (const c of recent) {
    const fp = footprintRef.current.get(c.time); if (!fp) continue;
    const agg = aggregateLevels(fp.levels, baseTick, effectiveTick);
    for (const [pk, { buy, sell }] of agg) {
      const prev = vpMap.get(pk) || { buy: 0, sell: 0 };
      vpMap.set(pk, { buy: prev.buy + buy, sell: prev.sell + sell });
    }
  }
  if (!vpMap.size) return;
  const entries = [...vpMap.entries()].map(([pk, { buy, sell }]) => ({ price: parseFloat(pk), vol: buy + sell }));
  const maxVol = Math.max(1, ...entries.map((e) => e.vol));
  const top5 = entries.filter((e) => e.vol >= maxVol * 0.65).sort((a, b) => b.vol - a.vol).slice(0, 6);
  for (const { price, vol } of top5) {
    const y = series.priceToCoordinate(price); if (y === null) continue;
    const alpha = 0.28 + (vol / maxVol) * 0.35;
    ctx.strokeStyle = `rgba(150,130,210,${alpha})`; ctx.lineWidth = 0.8 + (vol / maxVol); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '9px monospace'; ctx.fillStyle = `rgba(150,130,210,0.75)`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(price.toFixed(1), W - 4, y - 2);
  }
}

// ── Bar Timer ─────────────────────────────────────────────────────────────────

const TF_SECONDS = { '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1d':86400 };

function drawBarTimer(ctx, timeframe, candles, W) {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const lastC = sorted.at(-1); if (!lastC) return;
  const tfSecs = TF_SECONDS[timeframe] || 300;
  const remaining = Math.max(0, (lastC.time + tfSecs) - Date.now() / 1000);
  const mins = Math.floor(remaining / 60), secs = Math.floor(remaining % 60);
  const label = `${mins}:${secs.toString().padStart(2, '0')}`;
  const color = remaining < 10 ? '#f85149' : remaining < 30 ? '#e3b341' : '#8b949e';
  ctx.font = 'bold 11px monospace'; ctx.fillStyle = color;
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(label, W - 70, 6);
}

// ── Volume Profile ─────────────────────────────────────────────────────────────

function computeVolumeProfile(candles, footprintRef, startIdx, endIdx, effectiveTick) {
  const vpMap = new Map();
  for (let i = startIdx; i <= endIdx; i++) {
    const candle = candles[i];
    if (!candle) continue;
    const fp = footprintRef.current.get(candle.time);
    if (!fp) continue;
    const agg = aggregateLevels(fp.levels, TICK, effectiveTick);
    for (const [pk, { buy, sell }] of agg) {
      const prev = vpMap.get(pk) || { buy: 0, sell: 0 };
      vpMap.set(pk, { buy: prev.buy + buy, sell: prev.sell + sell });
    }
  }
  return vpMap;
}

function computeValueArea(vpMap, targetPct = 0.70) {
  if (!vpMap.size) return { poc: null, vah: null, val: null };
  const rows = [...vpMap.entries()]
    .map(([pk, { buy, sell }]) => ({ price: parseFloat(pk), vol: buy + sell }))
    .sort((a, b) => b.price - a.price);

  const totalVol = rows.reduce((s, r) => s + r.vol, 0);
  let pocIdx = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].vol > rows[pocIdx].vol) pocIdx = i;
  }

  let hi = pocIdx, lo = pocIdx;
  let accumulated = rows[pocIdx].vol;
  while (accumulated < totalVol * targetPct) {
    const upVol   = hi + 1 < rows.length ? rows[hi + 1].vol : 0;
    const downVol = lo - 1 >= 0          ? rows[lo - 1].vol : 0;
    if (upVol === 0 && downVol === 0) break;
    if (downVol >= upVol) { lo--; accumulated += downVol; }
    else                  { hi++; accumulated += upVol; }
  }

  return { poc: rows[pocIdx].price, vah: rows[hi].price, val: rows[lo].price };
}

// ATAS-style VP delta: gray total volume background + red/green buy-sell split overlay
function drawVolumeProfile(ctx, series, vpMap, va, W, vpLeft, vpWidth, effectiveTick) {
  if (!vpMap.size) return;

  const entries = [...vpMap.entries()].map(([pk, v]) => ({ price: parseFloat(pk), ...v }));
  const maxVol  = Math.max(1, ...entries.map((e) => e.buy + e.sell));

  // Value Area orange shading (ATAS style)
  if (va.vah !== null && va.val !== null) {
    const vahY = series.priceToCoordinate(va.vah);
    const valY = series.priceToCoordinate(va.val);
    if (vahY !== null && valY !== null) {
      ctx.fillStyle = 'rgba(200,140,60,0.14)';
      ctx.fillRect(vpLeft, Math.min(vahY, valY), vpWidth, Math.abs(valY - vahY));
    }
  }

  for (const { price, buy, sell } of entries) {
    const y = series.priceToCoordinate(price);
    if (y === null) continue;

    const totalVol = buy + sell;
    const barFullW = Math.max(1, Math.floor((totalVol / maxVol) * vpWidth));
    const sellW    = sell > 0 ? Math.max(0, Math.floor((sell / totalVol) * barFullW)) : 0;
    const buyW     = barFullW - sellW;

    const yNext  = series.priceToCoordinate(price - effectiveTick);
    const rowH   = yNext !== null ? Math.max(1, Math.abs(yNext - y) - 0.5) : 4;
    const rowTop = y - rowH / 2;

    // 1. Gray total volume background
    ctx.fillStyle = 'rgba(110,120,130,0.35)';
    ctx.fillRect(vpLeft, rowTop, barFullW, rowH);

    // 2. Sell (left, red) overlay
    if (sellW > 0) {
      ctx.fillStyle = 'rgba(215,55,45,0.75)';
      ctx.fillRect(vpLeft, rowTop, sellW, rowH);
    }

    // 3. Buy (right, green) overlay
    if (buyW > 0) {
      ctx.fillStyle = 'rgba(30,165,60,0.75)';
      ctx.fillRect(vpLeft + sellW, rowTop, buyW, rowH);
    }

    // POC yellow border
    if (va.poc !== null && Math.abs(price - va.poc) < effectiveTick * 0.5) {
      ctx.strokeStyle = 'rgba(240,200,50,0.95)';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(vpLeft + 0.75, rowTop + 0.75, barFullW - 1.5, Math.max(1, rowH - 1.5));
    }
  }

  // vPOC label (left of strip, yellow)
  if (va.poc !== null) {
    const y = series.priceToCoordinate(va.poc);
    if (y !== null) {
      ctx.font = 'bold 10px monospace'; ctx.fillStyle = 'rgba(240,200,50,0.9)';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('vPOC', vpLeft - 3, y);
    }
  }

  // VAH / VAL labels (warm amber, inside strip)
  if (va.vah !== null) {
    const y = series.priceToCoordinate(va.vah);
    if (y !== null) {
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(220,160,80,0.9)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('VAH', vpLeft + 2, y);
    }
  }
  if (va.val !== null) {
    const y = series.priceToCoordinate(va.val);
    if (y !== null) {
      ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(220,160,80,0.9)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('VAL', vpLeft + 2, y);
    }
  }
}

// ── Drawing renderers ──────────────────────────────────────────────────────────

function renderHLine(ctx, chart, series, d, W) {
  const y = series.priceToCoordinate(d.price);
  if (y === null) return;
  ctx.strokeStyle = d.color ?? '#e3b341';
  ctx.lineWidth   = d.lineWidth ?? 1.5;
  ctx.setLineDash(d.dash ?? [6, 3]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px monospace'; ctx.fillStyle = d.color ?? '#e3b341';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(d.price.toFixed(1), W - 4, y - 2);
}

function renderTrendLine(ctx, chart, series, d) {
  const x1 = chart.timeScale().timeToCoordinate(d.time1);
  const y1 = series.priceToCoordinate(d.price1);
  const x2 = chart.timeScale().timeToCoordinate(d.time2);
  const y2 = series.priceToCoordinate(d.price2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return;
  ctx.strokeStyle = d.color ?? '#58a6ff';
  ctx.lineWidth   = d.lineWidth ?? 1.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = d.color ?? '#58a6ff';
  ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
}

function renderRect(ctx, chart, series, d) {
  const x1 = chart.timeScale().timeToCoordinate(d.time1);
  const y1 = series.priceToCoordinate(d.price1);
  const x2 = chart.timeScale().timeToCoordinate(d.time2);
  const y2 = series.priceToCoordinate(d.price2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return;
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
  const color = d.color ?? '#58a6ff';
  ctx.fillStyle   = `${color}${Math.round((d.fillOpacity ?? 0.08) * 255).toString(16).padStart(2,'0')}`;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = color; ctx.lineWidth = d.lineWidth ?? 1.2; ctx.setLineDash([]);
  ctx.strokeRect(rx, ry, rw, rh);
}

function renderText(ctx, chart, series, d) {
  const x = chart.timeScale().timeToCoordinate(d.time);
  const y = series.priceToCoordinate(d.price);
  if (x === null || y === null) return;
  ctx.font = `bold ${d.fontSize ?? 12}px monospace`;
  ctx.fillStyle = d.color ?? '#e3b341';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(d.text, x + 4, y - 4);
}

// ── Fixed Range Volume Profile  (visual style: Rithmic / ATAS reference) ─────
//
//  Range background  : light-blue semi-transparent fill
//  VP bars           : gray/white horizontal bars growing right from xLeft
//                      bid(red)/ask(green) split inside each bar
//  Delta column      : teal/red bars growing left from xRight
//  vPOC line         : solid gray horizontal line spanning full range, label right
//  VAH / VAL lines   : dashed gray-purple, labels on right outside range
//  Boundary lines    : thin blue vertical dashes at xLeft / xRight
//
function renderVP(ctx, chart, series, d, candles, footprintRef, effectiveTick, symTick = DEFAULT_TICK) {
  const x1 = chart.timeScale().timeToCoordinate(d.time1);
  const x2 = chart.timeScale().timeToCoordinate(d.time2);
  if (x1 === null || x2 === null) return;

  const xLeft  = Math.min(x1, x2);
  const xRight = Math.max(x1, x2);
  const rangeW = xRight - xLeft;
  if (rangeW < 6) return;
  const canvasH = ctx.canvas.height / (window.devicePixelRatio || 1);

  const t1s = Math.min(d.time1, d.time2);
  const t2s = Math.max(d.time1, d.time2);
  const rc = candles.filter((c) => c.time >= t1s && c.time <= t2s);
  if (!rc.length) return;

  // ── VP-specific tick resolution ───────────────────────────────────────────
  // VP rows only need ≥0.8px (no text), so we can show much finer price levels
  // than the footprint chart (which needs ≥6px for numbers). Compute independently.
  const vpTick = (() => {
    const refPrice = candles.length ? candles[candles.length - 1].close : 100;
    const y0 = series.priceToCoordinate(refPrice);
    const y1 = series.priceToCoordinate(refPrice + symTick);
    if (y0 === null || y1 === null) return symTick;
    const pxPerTick = Math.abs(y1 - y0);
    for (const m of [1, 2, 5, 10, 25, 50, 100]) {
      if (pxPerTick * m >= 0.8) return symTick * m;
    }
    return symTick * 100;
  })();

  // Build VP map at vpTick resolution (not coarse effectiveTick)
  const vpMap = new Map();
  for (const c of rc) {
    const fp = footprintRef.current.get(c.time);
    if (!fp) continue;
    for (const [pk, { buy, sell }] of aggregateLevels(fp.levels, symTick, vpTick)) {
      const p = vpMap.get(pk) || { buy: 0, sell: 0 };
      vpMap.set(pk, { buy: p.buy + buy, sell: p.sell + sell });
    }
  }

  // ── 1. Range background — light-blue fill (like Rithmic blue highlight) ───
  const maxH = Math.max(...rc.map((c) => c.high));
  const minL = Math.min(...rc.map((c) => c.low));
  const yRangeTop = series.priceToCoordinate(maxH);
  const yRangeBot = series.priceToCoordinate(minL);
  if (yRangeTop !== null && yRangeBot !== null) {
    ctx.fillStyle = 'rgba(100,160,220,0.07)';
    ctx.fillRect(xLeft, yRangeTop, rangeW, yRangeBot - yRangeTop);
  }

  // ── 2. Range boundary lines — solid bright blue, clearly visible ──────────
  ctx.save();
  ctx.strokeStyle = 'rgba(80,160,255,0.90)'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(xLeft,  0); ctx.lineTo(xLeft,  canvasH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(xRight, 0); ctx.lineTo(xRight, canvasH); ctx.stroke();
  ctx.restore();

  if (!vpMap.size) {
    ctx.font = '11px monospace'; ctx.fillStyle = 'rgba(100,160,220,0.5)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (yRangeTop !== null && yRangeBot !== null)
      ctx.fillText('VP — loading…', xLeft + rangeW / 2, (yRangeTop + yRangeBot) / 2);
    return;
  }

  const va          = computeValueArea(vpMap);
  const maxVol      = Math.max(1, ...[...vpMap.values()].map((v) => v.buy + v.sell));
  const maxAbsDelta = Math.max(1, ...[...vpMap.values()].map((v) => Math.abs(v.buy - v.sell)));

  // ── Layout ────────────────────────────────────────────────────────────────
  // Axis = xLeft (left boundary of range)
  // Delta bars grow LEFTWARD  from xLeft (outside the range)
  // VP    bars grow RIGHTWARD from xLeft (fill the range)
  const vpMaxW    = rangeW;                            // VP fills entire range
  const deltaMaxW = Math.min(rangeW * 0.8, 110);      // delta extends left, capped

  // VP heatmap colour: dark-green(low) → orange(VA) → yellow(POC)
  const vpColor = (ratio, inVA) => {
    if (ratio > 0.90) return 'rgba(245,200,20,0.92)';   // POC — bright yellow
    if (ratio > 0.70) return 'rgba(255,145,0,0.85)';    // high vol — orange
    if (ratio > 0.45) {
      return inVA
        ? 'rgba(235,100,20,0.78)'                       // VA mid — orange-red
        : 'rgba(100,185,90,0.72)';                      // outside VA — green
    }
    if (ratio > 0.20) return 'rgba(55,140,60,0.65)';   // low-mid — darker green
    return 'rgba(30,80,35,0.55)';                       // very low — dark green
  };

  // ── 3. Value-area orange background (inside range) ────────────────────────
  if (va.vah !== null && va.val !== null) {
    const yVah = series.priceToCoordinate(va.vah);
    const yVal = series.priceToCoordinate(va.val - vpTick);
    if (yVah !== null && yVal !== null) {
      ctx.fillStyle = 'rgba(200,90,0,0.10)';
      ctx.fillRect(xLeft, Math.min(yVah, yVal), rangeW, Math.abs(yVal - yVah));
    }
  }

  // ── 4. Price rows ─────────────────────────────────────────────────────────
  for (const [pk, { buy, sell }] of vpMap) {
    const price  = parseFloat(pk);
    const y      = series.priceToCoordinate(price);
    if (y === null) continue;
    const yNext  = series.priceToCoordinate(price - vpTick);
    const rowH   = yNext !== null ? Math.max(0.8, Math.abs(yNext - y) - 0.3) : 2;
    const rowTop = y - rowH / 2;
    const total  = buy + sell;
    const ratio  = total / maxVol;

    // Is this price within the value area?
    const inVA = va.vah !== null && va.val !== null
      && price <= va.vah + vpTick * 0.5
      && price >= va.val - vpTick * 0.5;

    // ── VP bar: grows RIGHTWARD from xLeft ──────────────────────────────────
    const barW = Math.max(1, ratio * vpMaxW);
    ctx.fillStyle = vpColor(ratio, inVA);
    ctx.fillRect(xLeft, rowTop, barW, rowH);

    // Row separator (inside VP area)
    ctx.strokeStyle = 'rgba(15,20,28,0.50)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(xLeft, rowTop); ctx.lineTo(xLeft + barW, rowTop); ctx.stroke();

    // ── Delta bar: grows LEFTWARD from xLeft ─────────────────────────────────
    const delta = buy - sell;
    const dW    = (Math.abs(delta) / maxAbsDelta) * deltaMaxW;
    if (dW > 0.5) {
      // lime-green for positive Δ, hot-pink for negative — clearly ≠ K-line teal/red
      ctx.fillStyle = delta >= 0 ? 'rgba(163,230,53,0.82)' : 'rgba(244,114,182,0.82)';
      ctx.fillRect(xLeft - dW, rowTop, dW, rowH);
      // Separator inside delta area
      ctx.strokeStyle = 'rgba(15,20,28,0.45)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(xLeft - dW, rowTop); ctx.lineTo(xLeft, rowTop); ctx.stroke();
    }
  }

  // ── 5. Centre axis line (xLeft) ───────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = 'rgba(180,185,195,0.50)'; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(xLeft, 0); ctx.lineTo(xLeft, canvasH); ctx.stroke();
  ctx.restore();

  // ── 6. vPOC — bright yellow solid line across VP + into delta area ────────
  if (va.poc !== null) {
    const y = series.priceToCoordinate(va.poc);
    if (y !== null) {
      ctx.save();
      ctx.strokeStyle = '#f5c518'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xLeft - deltaMaxW * 0.25, y); ctx.lineTo(xRight, y); ctx.stroke();
      ctx.restore();
      ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#f5c518';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`vPOC  ${va.poc.toFixed(1)}`, xRight + 4, y);
    }
  }

  // ── 7. VAH / VAL — dashed gray-purple, extend into delta area ────────────
  const drawVaLine = (price, label) => {
    if (price === null) return;
    const y = series.priceToCoordinate(price);
    if (y === null) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(148,130,200,0.80)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(xLeft - deltaMaxW * 0.25, y); ctx.lineTo(xRight, y); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(148,130,200,0.90)';
    ctx.textAlign = 'left';
    ctx.textBaseline = label === 'VAH' ? 'bottom' : 'top';
    ctx.fillText(`${label}  ${price.toFixed(1)}`, xRight + 4, y + (label === 'VAH' ? -1 : 1));
  };
  drawVaLine(va.vah, 'VAH');
  drawVaLine(va.val, 'VAL');

  // ── 8. Right boundary line (already drawn in section 2, skip duplicate) ───

  // ── 9. Column headers ─────────────────────────────────────────────────────
  if (yRangeTop !== null) {
    ctx.font = '7px monospace'; ctx.fillStyle = 'rgba(110,120,135,0.65)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('Δ', xLeft - 2, yRangeTop - 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('VP', xLeft + 2, yRangeTop - 2);
  }
}

function renderDrawings(ctx, chart, series, drawings, preview, candles, footprintRef, effectiveTick, W, symTick = DEFAULT_TICK) {
  const all = [...drawings, preview].filter(Boolean);
  for (const d of all) {
    ctx.globalAlpha = d === preview ? 0.55 : 1.0;
    switch (d.type) {
      case 'hline':     renderHLine(ctx, chart, series, d, W); break;
      case 'trendline': renderTrendLine(ctx, chart, series, d); break;
      case 'rect':      renderRect(ctx, chart, series, d); break;
      case 'text':      renderText(ctx, chart, series, d); break;
      case 'vp':        renderVP(ctx, chart, series, d, candles, footprintRef, effectiveTick, symTick); break;
    }
    ctx.globalAlpha = 1.0;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Chart({
  candles, bigTrades, footprintRef, footprintVersion,
  activeTool, setActiveTool, showVP, onClearDrawings, indicators, timeframe, symbol,
}) {
  const containerRef    = useRef(null);
  const canvasRef       = useRef(null);
  const chartRef        = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef    = useRef(null);
  const deltaSeriesRef  = useRef(null);
  const fpModeRef       = useRef(false);

  // Refs declared before drawOverlay so the closure captures them
  const drawingsRef = useRef([]);
  const previewRef  = useRef(null);

  const dataRef = useRef({ candles, bigTrades, footprintRef, showVP, indicators, timeframe, symbol });
  useEffect(() => {
    dataRef.current = { candles, bigTrades, footprintRef, showVP, indicators, timeframe, symbol };
  }, [candles, bigTrades, footprintRef, showVP, indicators, timeframe, symbol]);

  // ── Update price axis format when symbol changes ──────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const tick = getTick(symbol);
    const dec  = tickDecimals(tick);
    candleSeriesRef.current.applyOptions({
      priceFormat: { type: 'price', minMove: tick, precision: dec },
    });
  }, [symbol]);

  // ── Overlay draw ─────────────────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const { candles, bigTrades, footprintRef, showVP, indicators, timeframe, symbol } = dataRef.current;
    const symTick = getTick(symbol); // e.g. ES=0.25, NQ=0.25, GC=0.10

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const H   = canvas.offsetHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!candles.length) return;

    const timeScale = chart.timeScale();

    // Candle width
    let stepPx = 0;
    if (candles.length >= 2) {
      const xa = timeScale.timeToCoordinate(candles[candles.length - 2].time);
      const xb = timeScale.timeToCoordinate(candles[candles.length - 1].time);
      if (xa !== null && xb !== null) stepPx = Math.abs(xb - xa);
    }
    const bodyW = Math.max(2, stepPx * 0.72);
    const halfW = bodyW / 2;

    const isFootprintMode = stepPx >= FOOTPRINT_THRESHOLD;

    if (isFootprintMode !== fpModeRef.current) {
      fpModeRef.current = isFootprintMode;
      series.applyOptions({ visible: !isFootprintMode });
      volSeriesRef.current?.applyOptions({ visible: !isFootprintMode });
      deltaSeriesRef.current?.applyOptions({ visible: !isFootprintMode });
    }

    // Visible candle range
    const logRange = timeScale.getVisibleLogicalRange();
    const startIdx = logRange ? Math.max(0, Math.floor(logRange.from) - 1) : 0;
    const endIdx   = logRange ? Math.min(candles.length - 1, Math.ceil(logRange.to) + 1) : candles.length - 1;

    // Effective tick for footprint (needs ≥6px per row for readable numbers)
    const refCandle     = candles[endIdx] || candles[candles.length - 1];
    const effectiveTick = refCandle ? computeEffectiveTick(series, refCandle.high, symTick) : symTick;

    // ── Big-trade bubbles (if indicator enabled or no indicator config) ─────────
    const btInd = indicators?.find((i) => i.type === 'bigtrades');
    if (!btInd || btInd.enabled) {
      for (const trade of bigTrades) {
        const tsS = Math.floor(trade.timestamp / 1000);
        let best = candles[0], minD = Math.abs(best.time - tsS);
        for (const c of candles) {
          const d = Math.abs(c.time - tsS);
          if (d < minD) { minD = d; best = c; }
        }
        const cx = timeScale.timeToCoordinate(best.time);
        const cy = series.priceToCoordinate(trade.price);
        if (cx === null || cy === null) continue;

        const r     = Math.min(28, Math.max(5, Math.sqrt(trade.notional / 45000) * 4.5));
        const isBuy = trade.side === 'buy';
        const grd   = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
        grd.addColorStop(0, isBuy ? 'rgba(8,153,129,0.6)' : 'rgba(242,54,69,0.6)');
        grd.addColorStop(1, isBuy ? 'rgba(8,153,129,0.04)' : 'rgba(242,54,69,0.04)');
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
        ctx.strokeStyle = isBuy ? '#089981' : '#f23645'; ctx.lineWidth = 1.2; ctx.stroke();
        if (r >= 8) {
          ctx.font = `bold ${Math.min(11, r * 0.72)}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e6edf3';
          ctx.fillText(fmtVol(trade.quantity), cx, cy);
        }
      }
    }

    // ── Footprint cells ────────────────────────────────────────────────────────
    if (isFootprintMode) {
      for (let i = startIdx; i <= endIdx; i++) {
        const candle = candles[i];
        if (!candle) continue;
        const cx = timeScale.timeToCoordinate(candle.time);
        if (cx === null) continue;

        const yHigh = series.priceToCoordinate(candle.high);
        const yLow  = series.priceToCoordinate(candle.low);
        if (yHigh === null || yLow === null) continue;

        const fp = footprintRef.current.get(candle.time);

        const topPrice    = Math.ceil(candle.high  / effectiveTick) * effectiveTick;
        const bottomPrice = Math.floor(candle.low  / effectiveTick) * effectiveTick;

        const levels  = fp ? aggregateLevels(fp.levels, symTick, effectiveTick) : new Map();
        let maxVol = 1;
        for (const { sell, buy } of levels.values()) maxVol = Math.max(maxVol, sell, buy);

        let pocKey = null, pocMax = 0;
        for (const [pk, { sell, buy }] of levels) {
          if (sell + buy > pocMax) { pocMax = sell + buy; pocKey = pk; }
        }

        const pxTop  = series.priceToCoordinate(topPrice) ?? yHigh;
        const pxBot  = series.priceToCoordinate(bottomPrice - effectiveTick) ?? yLow;
        const totalH = Math.abs(pxBot - pxTop);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(cx - halfW, pxTop, bodyW, totalH);

        const yT1       = series.priceToCoordinate(candle.high + TICK);
        const pxPerTick = (yT1 !== null && yHigh !== null) ? Math.abs(yT1 - yHigh) : 0;
        const rowPx     = pxPerTick * (effectiveTick / TICK);

        for (let p = topPrice; p >= bottomPrice - effectiveTick * 0.4; p -= effectiveTick) {
          const pk  = p.toFixed(1);
          const py  = series.priceToCoordinate(p);
          if (py === null) continue;

          const row   = levels.get(pk);
          const sell  = row?.sell ?? 0;
          const buy   = row?.buy  ?? 0;
          const isPOC = pk === pocKey && pocMax > 0;

          const rowTop = py - rowPx / 2;
          const rowH   = Math.max(1, rowPx - 0.5);

          const sellAlpha = sell > 0 ? 0.12 + (sell / maxVol) * 0.55 : 0.04;
          ctx.fillStyle   = `rgba(242,54,69,${sellAlpha})`;   // teal/red theme
          ctx.fillRect(cx - halfW, rowTop, halfW, rowH);

          const buyAlpha = buy > 0 ? 0.12 + (buy / maxVol) * 0.55 : 0.04;
          ctx.fillStyle  = `rgba(8,153,129,${buyAlpha})`;
          ctx.fillRect(cx, rowTop, halfW, rowH);

          if (isPOC) {
            ctx.strokeStyle = 'rgba(240,200,50,0.9)'; ctx.lineWidth = 1.5;
            ctx.strokeRect(cx - halfW + 1, rowTop + 1, bodyW - 2, rowH - 2);
          }

          if (rowH >= 8) {
            const fs = Math.max(7, Math.min(12, rowH * 0.68));
            ctx.font = `bold ${fs}px monospace`; ctx.textBaseline = 'middle';
            const midY = rowTop + rowH / 2;
            if (sell > 0) {
              ctx.fillStyle = sell > buy ? '#f87171' : '#fca5a5';
              ctx.textAlign = 'right'; ctx.fillText(fmtVol(sell), cx - 3, midY);
            }
            if (buy > 0) {
              ctx.fillStyle = buy > sell ? '#34d399' : '#6ee7b7';
              ctx.textAlign = 'left'; ctx.fillText(fmtVol(buy), cx + 3, midY);
            }
          }

          ctx.strokeStyle = 'rgba(48,54,61,0.55)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(cx - halfW, rowTop); ctx.lineTo(cx + halfW, rowTop); ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(80,90,100,0.6)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(cx, pxTop); ctx.lineTo(cx, pxBot); ctx.stroke();
        ctx.strokeStyle = 'rgba(70,80,90,0.85)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(cx - halfW, pxTop, bodyW, totalH);

        if (fp?.delta !== undefined) {
          const del = fp.delta;
          const fs  = Math.max(7, Math.min(11, bodyW / 5));
          ctx.fillStyle    = del >= 0 ? '#34d399' : '#f87171';
          ctx.font         = `bold ${fs}px monospace`;
          ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
          ctx.fillText((del >= 0 ? '+' : '') + del, cx, yLow + 3);
        }
      }
    }

    // ── Overlay indicators ────────────────────────────────────────────────────
    if (indicators) {
      for (const ind of indicators) {
        if (!ind.enabled) continue;
        if (ind.type === 'ema')      drawEMALine(ctx, chart, series, candles, ind.params.period, ind.params.color);
        if (ind.type === 'sma')      drawSMALine(ctx, chart, series, candles, ind.params.period, ind.params.color);
        if (ind.type === 'bollinger') drawBollingerBands(ctx, chart, series, candles, ind.params.period || 20, ind.params.stdDev || 2, ind.params.color);
        if (ind.type === 'vwap')     drawVWAP(ctx, chart, series, candles, ind.params.color || '#fb923c');
        if (ind.type === 'cvd')      drawCVDLine(ctx, chart, series, candles, ind.params.color || '#34d399', H);
      }
      const fvgInd = indicators.find((i) => i.type === 'fvg' && i.enabled);
      if (fvgInd) drawFVGs(ctx, chart, series, candles, fvgInd.params?.minGap ?? 0.5);
      const ibInd = indicators.find((i) => i.type === 'inside-bar' && i.enabled);
      if (ibInd) drawInsideBars(ctx, chart, series, candles, startIdx, endIdx);
      const siInd = indicators.find((i) => i.type === 'stacked-imbalance' && i.enabled);
      if (siInd && isFootprintMode) drawStackedImbalance(ctx, chart, series, candles, footprintRef, effectiveTick, siInd.params, startIdx, endIdx, symTick);
      const svpInd = indicators.find((i) => i.type === 'session-vp' && i.enabled);
      if (svpInd) drawSessionVP(ctx, chart, series, candles, footprintRef, effectiveTick, logRange, symTick);
      const klInd = indicators.find((i) => i.type === 'key-levels' && i.enabled);
      if (klInd) drawKeyLevels(ctx, chart, series, candles, footprintRef, effectiveTick, klInd.params?.lookback ?? 100, W, symTick);
      const btTimerInd = indicators.find((i) => i.type === 'bar-timer' && i.enabled);
      if (btTimerInd) drawBarTimer(ctx, timeframe, candles, W);
    }

    // ── Volume Profile ─────────────────────────────────────────────────────────
    if (showVP && logRange) {
      try {
        const rightScaleWidth = chart.priceScale('right').width() || 65;
        const vpWidth = Math.max(50, Math.floor(W * 0.14));
        const vpLeft  = W - rightScaleWidth - vpWidth - 4;

        const vpMap = computeVolumeProfile(candles, footprintRef, startIdx, endIdx, effectiveTick);
        const va    = computeValueArea(vpMap);
        if (vpMap.size > 0) {
          drawVolumeProfile(ctx, series, vpMap, va, W, vpLeft, vpWidth, effectiveTick);
        } else {
          // No footprint data yet — draw a placeholder
          ctx.font = '11px monospace'; ctx.fillStyle = 'rgba(110,120,130,0.5)';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('VP loading…', W - rightScaleWidth - vpWidth / 2 - 4, H / 2);
        }
      } catch (e) {
        // VP render failed silently
      }
    }

    // ── Drawings ───────────────────────────────────────────────────────────────
    renderDrawings(ctx, chart, series, drawingsRef.current, previewRef.current, candles, footprintRef, effectiveTick, W, symTick);

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { drawingVersion, editingDrawing, setEditingDrawing, updateDrawing, deleteDrawing, handleMouseDown, handleMouseMove, handleMouseUp, clearDrawings } =
    useDrawings({
      chartRef, candleSeriesRef, canvasRef,
      activeTool, setActiveTool, onRedraw: drawOverlay,
      drawingsRef, previewRef,
    });

  // ── Init chart ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      ...CHART_THEME,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    // Teal/red colour scheme — matches reference screenshot
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor:         '#089981',  borderUpColor:   '#089981',  wickUpColor:   '#089981',
      downColor:       '#f23645',  borderDownColor: '#f23645',  wickDownColor: '#f23645',
    });

    volSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
      lastValueVisible: false, priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    deltaSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'delta',
      lastValueVisible: false, priceLineVisible: false, base: 0,
    });
    chart.priceScale('delta').applyOptions({ scaleMargins: { top: 0.9, bottom: 0.01 } });

    chart.timeScale().subscribeVisibleTimeRangeChange(drawOverlay);
    chart.timeScale().subscribeVisibleLogicalRangeChange(drawOverlay);

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      drawOverlay();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(drawOverlay);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(drawOverlay);
      chart.remove();
    };
  }, [drawOverlay]);

  // ── Update OHLCV series ───────────────────────────────────────────────────────
  const prevCandlesLenRef = useRef(0);
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (candles.length === 0) {
      candleSeriesRef.current.setData([]);
      volSeriesRef.current?.setData([]);
      deltaSeriesRef.current?.setData([]);
      prevCandlesLenRef.current = 0;
      return;
    }
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    candleSeriesRef.current.setData(
      sorted.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }))
    );
    volSeriesRef.current.setData(
      sorted.map(({ time, buyVolume, sellVolume, open, close }) => ({
        time, value: (buyVolume || 0) + (sellVolume || 0),
        color: close >= open ? 'rgba(8,153,129,0.5)' : 'rgba(242,54,69,0.5)',
      }))
    );
    deltaSeriesRef.current.setData(
      sorted.map(({ time, buyVolume, sellVolume }) => {
        const d = (buyVolume || 0) - (sellVolume || 0);
        return { time, value: d, color: d >= 0 ? 'rgba(8,153,129,0.8)' : 'rgba(242,54,69,0.8)' };
      })
    );
    if (prevCandlesLenRef.current === 0 && candles.length > 1) {
      chartRef.current?.timeScale().fitContent();
    }
    prevCandlesLenRef.current = candles.length;
  }, [candles]);

  // ── Redraw on any data/indicator change ──────────────────────────────────────
  useEffect(() => {
    drawOverlay();
  }, [candles, bigTrades, footprintVersion, showVP, drawingVersion, indicators, timeframe, drawOverlay]);

  useEffect(() => {
    if (onClearDrawings) onClearDrawings.current = clearDrawings;
  }, [clearDrawings, onClearDrawings]);

  const isDrawingMode = activeTool && activeTool !== 'cursor';

  // ── Double-click → open props panel ──────────────────────────────────────
  useEffect(() => {
    if (isDrawingMode) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      const chart  = chartRef.current;
      const series = candleSeriesRef.current;
      const canvas = canvasRef.current;
      if (!chart || !series || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px   = e.clientX - rect.left;
      const py   = e.clientY - rect.top;
      const hit  = [...drawingsRef.current].reverse().find((d) => hitTest(d, px, py, chart, series));
      if (hit) setEditingDrawing({ drawing: hit, screenX: e.clientX, screenY: e.clientY });
    };
    el.addEventListener('dblclick', handler, true);
    return () => el.removeEventListener('dblclick', handler, true);
  }, [isDrawingMode, chartRef, candleSeriesRef, canvasRef, drawingsRef, setEditingDrawing]);

  // ── Drag-to-move drawings / VP re-drag ────────────────────────────────────
  const dragRef = useRef(null); // { drawing, origDrawing, startClientX, startClientY }
  useEffect(() => {
    if (isDrawingMode) return;
    const el = containerRef.current;
    if (!el) return;

    const getScreenPos = (clientX, clientY) => {
      const canvas = canvasRef.current;
      if (!canvas) return { px: 0, py: 0 };
      const rect = canvas.getBoundingClientRect();
      return { px: clientX - rect.left, py: clientY - rect.top };
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      const chart  = chartRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return;
      const { px, py } = getScreenPos(e.clientX, e.clientY);
      const hit = [...drawingsRef.current].reverse().find((d) => hitTest(d, px, py, chart, series));
      if (!hit) return;
      // Intercept: prevent chart pan when hitting a drawing
      e.stopPropagation();
      dragRef.current = {
        drawing:      hit,
        origDrawing:  { ...hit },
        startClientX: e.clientX,
        startClientY: e.clientY,
        vpRedrag:     hit.type === 'vp', // VP uses redrag (redefine range), others translate
      };
    };

    const onMove = (e) => {
      if (!dragRef.current) return;
      const { drawing, origDrawing, startClientX, startClientY, vpRedrag } = dragRef.current;
      const chart  = chartRef.current;
      const series = candleSeriesRef.current;
      if (!chart || !series) return;

      const { px: curPx, py: curPy } = getScreenPos(e.clientX, e.clientY);
      const { px: startPx, py: startPy } = getScreenPos(startClientX, startClientY);
      const dPx = curPx - startPx;
      const dPy = curPy - startPy;

      // Helper: shift a time coordinate by dPx pixels
      const shiftTime = (origTime) => {
        const origX = chart.timeScale().timeToCoordinate(origTime);
        if (origX === null) return origTime;
        return chart.timeScale().coordinateToTime(origX + dPx) ?? origTime;
      };
      // Helper: shift a price coordinate by dPy pixels
      const shiftPrice = (origPrice) => {
        const origY = series.priceToCoordinate(origPrice);
        if (origY === null) return origPrice;
        return series.coordinateToPrice(origY + dPy) ?? origPrice;
      };

      let patch = {};
      if (vpRedrag) {
        // VP: redefine time range from mousedown position to current drag position
        const t1 = chart.timeScale().coordinateToTime(startPx);
        const t2 = chart.timeScale().coordinateToTime(curPx);
        if (t1 && t2) patch = { time1: Math.min(t1, t2), time2: Math.max(t1, t2) };
      } else {
        switch (drawing.type) {
          case 'hline':
            patch = { price: shiftPrice(origDrawing.price) };
            break;
          case 'trendline':
            patch = {
              price1: shiftPrice(origDrawing.price1), time1: shiftTime(origDrawing.time1),
              price2: shiftPrice(origDrawing.price2), time2: shiftTime(origDrawing.time2),
            };
            break;
          case 'rect':
            patch = {
              price1: shiftPrice(origDrawing.price1), time1: shiftTime(origDrawing.time1),
              price2: shiftPrice(origDrawing.price2), time2: shiftTime(origDrawing.time2),
            };
            break;
          case 'text':
            patch = { price: shiftPrice(origDrawing.price), time: shiftTime(origDrawing.time) };
            break;
          default: break;
        }
      }
      if (Object.keys(patch).length) {
        updateDrawing(drawing.id, patch);
        drawOverlay();
      }
    };

    const onUp = () => { dragRef.current = null; };

    el.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDrawingMode, chartRef, candleSeriesRef, canvasRef, drawingsRef, updateDrawing, drawOverlay]);

  // ── Hover cursor: show 'move' when over a drawing in cursor mode ─────────
  const hoverCursorRef = useRef('default');
  useEffect(() => {
    if (isDrawingMode) return;
    const el = containerRef.current;
    if (!el) return;
    const onHover = (e) => {
      const chart  = chartRef.current;
      const series = candleSeriesRef.current;
      const canvas = canvasRef.current;
      if (!chart || !series || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const hit = drawingsRef.current.some((d) => hitTest(d, px, py, chart, series));
      const cursor = hit ? 'move' : 'default';
      if (cursor !== hoverCursorRef.current) {
        hoverCursorRef.current = cursor;
        el.style.cursor = cursor;
      }
    };
    el.addEventListener('mousemove', onHover);
    return () => el.removeEventListener('mousemove', onHover);
  }, [isDrawingMode, chartRef, candleSeriesRef, canvasRef, drawingsRef]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={isDrawingMode ? handleMouseDown : undefined}
        onMouseMove={isDrawingMode ? handleMouseMove : undefined}
        onMouseUp={isDrawingMode ? handleMouseUp : undefined}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          zIndex: 10,
          pointerEvents: isDrawingMode ? 'auto' : 'none',
          cursor: isDrawingMode ? 'crosshair' : 'default',
        }}
      />
      {editingDrawing && (
        <DrawingPropsModal
          editingDrawing={editingDrawing}
          onUpdate={updateDrawing}
          onDelete={deleteDrawing}
          onClose={() => setEditingDrawing(null)}
        />
      )}
    </div>
  );
}
