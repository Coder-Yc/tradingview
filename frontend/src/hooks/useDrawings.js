import { useRef, useState, useCallback } from 'react';

let _uid = 0;
const uid = () => (++_uid).toString(36);

// ── Hit-test ────────────────────────────────────────────────────────────────
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTest(d, px, py, chart, series) {
  const HIT = 8;
  switch (d.type) {
    case 'hline': {
      const cy = series.priceToCoordinate(d.price);
      return cy !== null && Math.abs(py - cy) < HIT;
    }
    case 'trendline': {
      const x1 = chart.timeScale().timeToCoordinate(d.time1);
      const y1 = series.priceToCoordinate(d.price1);
      const x2 = chart.timeScale().timeToCoordinate(d.time2);
      const y2 = series.priceToCoordinate(d.price2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return false;
      return distToSegment(px, py, x1, y1, x2, y2) < HIT;
    }
    case 'rect': {
      const x1 = chart.timeScale().timeToCoordinate(d.time1);
      const y1 = series.priceToCoordinate(d.price1);
      const x2 = chart.timeScale().timeToCoordinate(d.time2);
      const y2 = series.priceToCoordinate(d.price2);
      if (x1 == null || y1 == null || x2 == null || y2 == null) return false;
      const rx = Math.min(x1, x2) - HIT, rX = Math.max(x1, x2) + HIT;
      const ry = Math.min(y1, y2) - HIT, rY = Math.max(y1, y2) + HIT;
      return px >= rx && px <= rX && py >= ry && py <= rY;
    }
    case 'vp': {
      const x1 = chart.timeScale().timeToCoordinate(d.time1);
      const x2 = chart.timeScale().timeToCoordinate(d.time2);
      if (x1 == null || x2 == null) return false;
      // delta extends ~110px to the left of xLeft, so widen hit area
      const xL = Math.min(x1, x2) - 115;
      const xR = Math.max(x1, x2) + HIT;
      return px >= xL && px <= xR;
    }
    case 'text': {
      const tx = chart.timeScale().timeToCoordinate(d.time);
      const ty = series.priceToCoordinate(d.price);
      if (tx == null || ty == null) return false;
      return Math.hypot(px - tx, py - ty) < 20;
    }
    default: return false;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────────
export default function useDrawings({
  chartRef, candleSeriesRef, canvasRef,
  activeTool, setActiveTool,
  onRedraw, drawingsRef, previewRef,
}) {
  const [drawingVersion, setDrawingVersion] = useState(0);
  const [editingDrawing, setEditingDrawing] = useState(null); // { drawing, screenX, screenY }
  const stateRef = useRef({ phase: 'idle', p1: null });

  const eventToWorld = useCallback((e) => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return null;
    const rect  = canvas.getBoundingClientRect();
    const cx    = e.clientX - rect.left;
    const cy    = e.clientY - rect.top;
    const time  = chart.timeScale().coordinateToTime(cx);
    const price = series.coordinateToPrice(cy);
    if (time == null || price == null) return null;
    return { time, price, cx, cy };
  }, [chartRef, candleSeriesRef, canvasRef]);

  const commit = useCallback((drawing) => {
    drawingsRef.current = [...drawingsRef.current, { id: uid(), ...drawing }];
    previewRef.current  = null;
    stateRef.current    = { phase: 'idle', p1: null };
    setDrawingVersion((v) => v + 1);
    setActiveTool('cursor');
  }, [drawingsRef, previewRef, setActiveTool]);

  const updateDrawing = useCallback((id, patch) => {
    drawingsRef.current = drawingsRef.current.map((d) => d.id === id ? { ...d, ...patch } : d);
    setEditingDrawing((prev) => prev ? { ...prev, drawing: { ...prev.drawing, ...patch } } : null);
    setDrawingVersion((v) => v + 1);
  }, [drawingsRef]);

  const deleteDrawing = useCallback((id) => {
    drawingsRef.current = drawingsRef.current.filter((d) => d.id !== id);
    setEditingDrawing(null);
    setDrawingVersion((v) => v + 1);
  }, [drawingsRef]);

  const handleMouseDown = useCallback((e) => {
    // cursor mode: no drawing action needed — double-click handled separately in Chart.jsx
    if (activeTool === 'cursor') return;

    // ── drawing tools ──────────────────────────────────────────────────────
    e.preventDefault();
    const w = eventToWorld(e);
    if (!w) return;
    switch (activeTool) {
      case 'hline':
        commit({ type: 'hline', price: w.price, color: '#e3b341', lineWidth: 1.5, dash: [5, 3] });
        break;

      case 'trendline':
        if (stateRef.current.phase === 'idle') {
          stateRef.current   = { phase: 'awaiting-p2', p1: w };
          previewRef.current = { type: 'trendline', price1: w.price, time1: w.time, price2: w.price, time2: w.time, color: '#58a6ff', lineWidth: 1.5 };
          onRedraw();
        } else {
          const p1 = stateRef.current.p1;
          commit({ type: 'trendline', price1: p1.price, time1: p1.time, price2: w.price, time2: w.time, color: '#58a6ff', lineWidth: 1.5 });
        }
        break;

      case 'rect':
        if (stateRef.current.phase === 'idle') {
          stateRef.current   = { phase: 'dragging', p1: w };
          previewRef.current = { type: 'rect', price1: w.price, time1: w.time, price2: w.price, time2: w.time, color: '#58a6ff', fillOpacity: 0.08 };
          onRedraw();
        }
        break;

      case 'vp':
        if (stateRef.current.phase === 'idle') {
          stateRef.current   = { phase: 'dragging', p1: w };
          previewRef.current = { type: 'vp', time1: w.time, time2: w.time };
          onRedraw();
        }
        break;

      case 'text': {
        const text = window.prompt('Label:');
        if (text?.trim()) commit({ type: 'text', price: w.price, time: w.time, text: text.trim(), color: '#e3b341', fontSize: 12 });
        else setActiveTool('cursor');
        break;
      }
      default: break;
    }
  }, [activeTool, commit, eventToWorld, onRedraw, previewRef, setActiveTool]);

  const handleMouseMove = useCallback((e) => {
    const w = eventToWorld(e);
    if (!w) return;
    if (activeTool === 'trendline' && stateRef.current.phase === 'awaiting-p2') {
      previewRef.current = { type: 'trendline', price1: stateRef.current.p1.price, time1: stateRef.current.p1.time, price2: w.price, time2: w.time, color: '#58a6ff', lineWidth: 1.5 };
      onRedraw();
    } else if (activeTool === 'rect' && stateRef.current.phase === 'dragging') {
      previewRef.current = { type: 'rect', price1: stateRef.current.p1.price, time1: stateRef.current.p1.time, price2: w.price, time2: w.time, color: '#58a6ff', fillOpacity: 0.08 };
      onRedraw();
    } else if (activeTool === 'vp' && stateRef.current.phase === 'dragging') {
      previewRef.current = { type: 'vp', time1: stateRef.current.p1.time, time2: w.time };
      onRedraw();
    }
  }, [activeTool, eventToWorld, onRedraw, previewRef]);

  const handleMouseUp = useCallback((e) => {
    const w = eventToWorld(e);
    if (!w) return;
    if (activeTool === 'rect' && stateRef.current.phase === 'dragging') {
      const p1 = stateRef.current.p1;
      commit({ type: 'rect', price1: p1.price, time1: p1.time, price2: w.price, time2: w.time, color: '#58a6ff', fillOpacity: 0.08 });
    } else if (activeTool === 'vp' && stateRef.current.phase === 'dragging') {
      const t1 = stateRef.current.p1.time;
      const t2 = w.time;
      if (Math.abs(t2 - t1) > 0) {
        commit({ type: 'vp', time1: Math.min(t1, t2), time2: Math.max(t1, t2) });
      } else {
        previewRef.current = null;
        stateRef.current   = { phase: 'idle', p1: null };
        setActiveTool('cursor');
        onRedraw();
      }
    }
  }, [activeTool, commit, eventToWorld, previewRef, setActiveTool, onRedraw]);

  const clearDrawings = useCallback(() => {
    drawingsRef.current = [];
    previewRef.current  = null;
    stateRef.current    = { phase: 'idle', p1: null };
    setEditingDrawing(null);
    setDrawingVersion((v) => v + 1);
  }, [drawingsRef, previewRef]);

  return { drawingVersion, editingDrawing, setEditingDrawing, updateDrawing, deleteDrawing, handleMouseDown, handleMouseMove, handleMouseUp, clearDrawings };
}
