import { useEffect, useRef, useCallback } from 'react';
import { createChart, CrosshairMode, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import useDrawings from '../hooks/useDrawings';

const CHART_THEME = {
  layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
  grid:   { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#30363d' },
  timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
};

const FOOTPRINT_THRESHOLD = 52;
const TICK = 0.1;

// ── Helpers ────────────────────────────────────────────────────────────────────

function aggregateLevels(levels, baseTick, effectiveTick) {
  if (effectiveTick <= baseTick) return levels;
  const merged = new Map();
  for (const [priceStr, { sell, buy, trades }] of levels) {
    const price   = parseFloat(priceStr);
    const snapped = (Math.floor(price / effectiveTick) * effectiveTick).toFixed(1);
    const prev    = merged.get(snapped) || { sell: 0, buy: 0, trades: 0 };
    merged.set(snapped, { sell: prev.sell + sell, buy: prev.buy + buy, trades: prev.trades + trades });
  }
  return merged;
}

function computeEffectiveTick(series, referencePrice) {
  const yT0 = series.priceToCoordinate(referencePrice);
  const yT1 = series.priceToCoordinate(referencePrice + TICK);
  if (yT0 === null || yT1 === null) return TICK;
  const pxPerTick = Math.abs(yT1 - yT0);
  for (const m of [1, 2, 5, 10, 25, 50, 100]) {
    if (pxPerTick * m >= 6) return TICK * m;
  }
  return TICK * 100;
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
  ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '11px monospace'; ctx.fillStyle = '#e3b341';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(d.price.toFixed(1), W - 4, y - 2);
}

function renderTrendLine(ctx, chart, series, d) {
  const x1 = chart.timeScale().timeToCoordinate(d.time1);
  const y1 = series.priceToCoordinate(d.price1);
  const x2 = chart.timeScale().timeToCoordinate(d.time2);
  const y2 = series.priceToCoordinate(d.price2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return;
  ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = '#58a6ff';
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
  ctx.fillStyle = 'rgba(88,166,255,0.08)'; ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  ctx.strokeRect(rx, ry, rw, rh);
}

function renderText(ctx, chart, series, d) {
  const x = chart.timeScale().timeToCoordinate(d.time);
  const y = series.priceToCoordinate(d.price);
  if (x === null || y === null) return;
  ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#e3b341';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(d.text, x + 4, y - 4);
}

function renderDrawings(ctx, chart, series, drawings, preview, W) {
  const all = [...drawings, preview].filter(Boolean);
  for (const d of all) {
    ctx.globalAlpha = d === preview ? 0.6 : 1.0;
    switch (d.type) {
      case 'hline':     renderHLine(ctx, chart, series, d, W); break;
      case 'trendline': renderTrendLine(ctx, chart, series, d); break;
      case 'rect':      renderRect(ctx, chart, series, d); break;
      case 'text':      renderText(ctx, chart, series, d); break;
    }
    ctx.globalAlpha = 1.0;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Chart({
  candles, bigTrades, footprintRef, footprintVersion,
  activeTool, setActiveTool, showVP, onClearDrawings, indicators,
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

  const dataRef = useRef({ candles, bigTrades, footprintRef, showVP, indicators });
  useEffect(() => {
    dataRef.current = { candles, bigTrades, footprintRef, showVP, indicators };
  }, [candles, bigTrades, footprintRef, showVP, indicators]);

  // ── Overlay draw ─────────────────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const { candles, bigTrades, footprintRef, showVP, indicators } = dataRef.current;

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

    // Effective tick (shared by footprint + VP)
    const refCandle    = candles[endIdx] || candles[candles.length - 1];
    const effectiveTick = refCandle ? computeEffectiveTick(series, refCandle.high) : TICK;

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
        grd.addColorStop(0, isBuy ? 'rgba(38,166,65,0.6)' : 'rgba(248,81,73,0.6)');
        grd.addColorStop(1, isBuy ? 'rgba(38,166,65,0.04)' : 'rgba(248,81,73,0.04)');
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
        ctx.strokeStyle = isBuy ? '#26a641' : '#f85149'; ctx.lineWidth = 1.2; ctx.stroke();
        if (r >= 8) {
          ctx.font = `bold ${Math.min(11, r * 0.72)}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e6edf3';
          ctx.fillText(trade.quantity, cx, cy);
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

        const levels  = fp ? aggregateLevels(fp.levels, TICK, effectiveTick) : new Map();
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
          ctx.fillStyle   = `rgba(200,50,50,${sellAlpha})`;
          ctx.fillRect(cx - halfW, rowTop, halfW, rowH);

          const buyAlpha = buy > 0 ? 0.12 + (buy / maxVol) * 0.55 : 0.04;
          ctx.fillStyle  = `rgba(30,160,60,${buyAlpha})`;
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
              ctx.fillStyle = sell > buy ? '#ff8a80' : '#ef9a9a';
              ctx.textAlign = 'right'; ctx.fillText(sell, cx - 3, midY);
            }
            if (buy > 0) {
              ctx.fillStyle = buy > sell ? '#69f0ae' : '#a5d6a7';
              ctx.textAlign = 'left'; ctx.fillText(buy, cx + 3, midY);
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
          ctx.fillStyle    = del >= 0 ? '#69f0ae' : '#ff8a80';
          ctx.font         = `bold ${fs}px monospace`;
          ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
          ctx.fillText((del >= 0 ? '+' : '') + del, cx, yLow + 3);
        }
      }
    }

    // ── EMA lines ─────────────────────────────────────────────────────────────
    if (indicators) {
      for (const ind of indicators) {
        if (ind.type === 'ema' && ind.enabled) {
          drawEMALine(ctx, chart, series, candles, ind.params.period, ind.params.color);
        }
      }
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
    renderDrawings(ctx, chart, series, drawingsRef.current, previewRef.current, W);

  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { drawingVersion, handleMouseDown, handleMouseMove, handleMouseUp, clearDrawings } =
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

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#26a641', downColor: '#f85149',
      borderUpColor: '#26a641', borderDownColor: '#f85149',
      wickUpColor: '#3fb950', wickDownColor: '#f85149',
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
        color: close >= open ? 'rgba(38,166,65,0.5)' : 'rgba(248,81,73,0.5)',
      }))
    );
    deltaSeriesRef.current.setData(
      sorted.map(({ time, buyVolume, sellVolume }) => {
        const d = (buyVolume || 0) - (sellVolume || 0);
        return { time, value: d, color: d >= 0 ? 'rgba(38,166,65,0.8)' : 'rgba(248,81,73,0.8)' };
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
  }, [candles, bigTrades, footprintVersion, showVP, drawingVersion, indicators, drawOverlay]);

  useEffect(() => {
    if (onClearDrawings) onClearDrawings.current = clearDrawings;
  }, [clearDrawings, onClearDrawings]);

  const isDrawingMode = activeTool && activeTool !== 'cursor';

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={isDrawingMode ? handleMouseDown : undefined}
        onMouseMove={isDrawingMode ? handleMouseMove : undefined}
        onMouseUp={isDrawingMode ? handleMouseUp : undefined}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 10,
          pointerEvents: isDrawingMode ? 'auto' : 'none',
          cursor: isDrawingMode ? 'crosshair' : 'default',
        }}
      />
    </div>
  );
}
