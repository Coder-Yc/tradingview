import { useEffect, useRef, useCallback } from 'react';
import { createChart, CrosshairMode, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

const CHART_THEME = {
  layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
  grid:   { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#30363d' },
  timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
};

const FOOTPRINT_THRESHOLD = 52; // px per candle to activate footprint

// Aggregate levels to coarser tick when price rows are too thin
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

export default function Chart({ candles, bigTrades, footprintRef, footprintVersion }) {
  const containerRef    = useRef(null);
  const canvasRef       = useRef(null);
  const chartRef        = useRef(null);
  const candleSeriesRef = useRef(null);
  const volSeriesRef    = useRef(null);
  const deltaSeriesRef  = useRef(null);
  const fpModeRef       = useRef(false); // tracks current footprint mode

  const dataRef = useRef({ candles, bigTrades, footprintRef });
  useEffect(() => { dataRef.current = { candles, bigTrades, footprintRef }; }, [candles, bigTrades, footprintRef]);

  // ── Overlay draw ───────────────────────────────────────────────────────────
  const drawOverlay = useCallback(() => {
    const canvas      = canvasRef.current;
    const chart       = chartRef.current;
    const series      = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const { candles, bigTrades, footprintRef } = dataRef.current;
    if (!candles.length) return;

    // Hi-DPI canvas sizing
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

    const timeScale = chart.timeScale();

    // Candle width in pixels
    let stepPx = 0;
    if (candles.length >= 2) {
      const xa = timeScale.timeToCoordinate(candles[candles.length - 2].time);
      const xb = timeScale.timeToCoordinate(candles[candles.length - 1].time);
      if (xa !== null && xb !== null) stepPx = Math.abs(xb - xa);
    }
    const bodyW = Math.max(2, stepPx * 0.72);
    const halfW = bodyW / 2;

    const isFootprintMode = stepPx >= FOOTPRINT_THRESHOLD;

    // Toggle traditional candlestick visibility
    if (isFootprintMode !== fpModeRef.current) {
      fpModeRef.current = isFootprintMode;
      series.applyOptions({ visible: !isFootprintMode });
      volSeriesRef.current?.applyOptions({ visible: !isFootprintMode });
      deltaSeriesRef.current?.applyOptions({ visible: !isFootprintMode });
    }

    // ── Big-trade bubbles ─────────────────────────────────────────────────
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
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = isBuy ? '#26a641' : '#f85149';
      ctx.lineWidth   = 1.2;
      ctx.stroke();
      if (r >= 8) {
        ctx.font         = `bold ${Math.min(11, r * 0.72)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = '#e6edf3';
        ctx.fillText(trade.quantity, cx, cy);
      }
    }

    // ── Footprint cells ───────────────────────────────────────────────────
    if (!isFootprintMode) return;

    const logRange = timeScale.getVisibleLogicalRange();
    if (!logRange) return;
    const startIdx = Math.max(0, Math.floor(logRange.from) - 1);
    const endIdx   = Math.min(candles.length - 1, Math.ceil(logRange.to) + 1);

    for (let i = startIdx; i <= endIdx; i++) {
      const candle = candles[i];
      if (!candle) continue;
      const cx = timeScale.timeToCoordinate(candle.time);
      if (cx === null) continue;

      const yHigh = series.priceToCoordinate(candle.high);
      const yLow  = series.priceToCoordinate(candle.low);
      if (yHigh === null || yLow === null) continue;

      const fp = footprintRef.current.get(candle.time);

      // ── Determine effective tick size ───────────────────────────────────
      const TICK       = 0.1;
      const yT0        = series.priceToCoordinate(candle.high);
      const yT1        = series.priceToCoordinate(candle.high + TICK);
      const pxPerTick  = (yT0 !== null && yT1 !== null) ? Math.abs(yT1 - yT0) : 0;
      if (pxPerTick === 0) continue;

      let effectiveTick = TICK;
      for (const m of [1, 2, 5, 10, 25, 50, 100]) {
        if (pxPerTick * m >= 6) { effectiveTick = TICK * m; break; }
      }
      const rowPx = pxPerTick * (effectiveTick / TICK);

      // Price range: snap to effective tick
      const topPrice    = Math.ceil(candle.high  / effectiveTick) * effectiveTick;
      const bottomPrice = Math.floor(candle.low  / effectiveTick) * effectiveTick;

      const levels  = fp ? aggregateLevels(fp.levels, TICK, effectiveTick) : new Map();
      let maxVol = 1;
      for (const { sell, buy } of levels.values()) maxVol = Math.max(maxVol, sell, buy);

      // POC = highest total volume
      let pocKey = null, pocMax = 0;
      for (const [pk, { sell, buy }] of levels) {
        if (sell + buy > pocMax) { pocMax = sell + buy; pocKey = pk; }
      }

      // ── Solid background covering the full price range (hides candlestick) ──
      const pxTop = series.priceToCoordinate(topPrice) ?? yHigh;
      const pxBot = series.priceToCoordinate(bottomPrice - effectiveTick) ?? yLow;
      const totalH = Math.abs(pxBot - pxTop);
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(cx - halfW, pxTop, bodyW, totalH);

      // ── Draw every row from topPrice → bottomPrice ───────────────────────
      for (let p = topPrice; p >= bottomPrice - effectiveTick * 0.4; p -= effectiveTick) {
        const pk  = p.toFixed(1);
        const py  = series.priceToCoordinate(p);
        if (py === null) continue;

        const row    = levels.get(pk);
        const sell   = row?.sell ?? 0;
        const buy    = row?.buy  ?? 0;
        const isPOC  = pk === pocKey && pocMax > 0;

        const rowTop = py - rowPx / 2;
        const rowH   = Math.max(1, rowPx - 0.5);

        // Sell side (left) – red heat
        const sellAlpha = sell > 0 ? 0.12 + (sell / maxVol) * 0.55 : 0.04;
        ctx.fillStyle   = `rgba(200,50,50,${sellAlpha})`;
        ctx.fillRect(cx - halfW, rowTop, halfW, rowH);

        // Buy side (right) – green heat
        const buyAlpha = buy > 0 ? 0.12 + (buy / maxVol) * 0.55 : 0.04;
        ctx.fillStyle  = `rgba(30,160,60,${buyAlpha})`;
        ctx.fillRect(cx, rowTop, halfW, rowH);

        // POC highlight border
        if (isPOC) {
          ctx.strokeStyle = 'rgba(240,200,50,0.9)';
          ctx.lineWidth   = 1.5;
          ctx.strokeRect(cx - halfW + 1, rowTop + 1, bodyW - 2, rowH - 2);
        }

        // Volume numbers
        if (rowH >= 8) {
          const fs = Math.max(7, Math.min(12, rowH * 0.68));
          ctx.font         = `bold ${fs}px monospace`;
          ctx.textBaseline = 'middle';
          const midY = rowTop + rowH / 2;

          if (sell > 0) {
            ctx.fillStyle = sell > buy ? '#ff8a80' : '#ef9a9a';
            ctx.textAlign = 'right';
            ctx.fillText(sell, cx - 3, midY);
          }
          if (buy > 0) {
            ctx.fillStyle = buy > sell ? '#69f0ae' : '#a5d6a7';
            ctx.textAlign = 'left';
            ctx.fillText(buy, cx + 3, midY);
          }
        }

        // Row divider
        ctx.strokeStyle = 'rgba(48,54,61,0.55)';
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - halfW, rowTop);
        ctx.lineTo(cx + halfW, rowTop);
        ctx.stroke();
      }

      // Center divider line (sell | buy)
      ctx.strokeStyle = 'rgba(80,90,100,0.6)';
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, pxTop);
      ctx.lineTo(cx, pxBot);
      ctx.stroke();

      // Outer border
      ctx.strokeStyle = 'rgba(70,80,90,0.85)';
      ctx.lineWidth   = 0.8;
      ctx.strokeRect(cx - halfW, pxTop, bodyW, totalH);

      // Delta label below
      if (fp?.delta !== undefined) {
        const del = fp.delta;
        const fs  = Math.max(7, Math.min(11, bodyW / 5));
        ctx.fillStyle    = del >= 0 ? '#69f0ae' : '#ff8a80';
        ctx.font         = `bold ${fs}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText((del >= 0 ? '+' : '') + del, cx, yLow + 3);
      }
    }
  }, []);

  // ── Init chart ─────────────────────────────────────────────────────────────
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

  // ── Update OHLCV series ────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
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
  }, [candles]);

  // ── Redraw whenever data changes ───────────────────────────────────────────
  useEffect(() => { drawOverlay(); }, [candles, bigTrades, footprintVersion, drawOverlay]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
      />
    </div>
  );
}
