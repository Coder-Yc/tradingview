import { useRef, useState, useCallback } from 'react';

let _uid = 0;
const uid = () => (++_uid).toString(36);

// drawingsRef and previewRef are passed in from Chart so drawOverlay can close over them directly
export default function useDrawings({ chartRef, candleSeriesRef, canvasRef, activeTool, setActiveTool, onRedraw, drawingsRef, previewRef }) {
  const [drawingVersion, setDrawingVersion] = useState(0);
  const stateRef = useRef({ phase: 'idle', p1: null });

  const eventToWorld = useCallback((e) => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return null;
    const rect  = canvas.getBoundingClientRect();
    const x     = e.clientX - rect.left;
    const y     = e.clientY - rect.top;
    const time  = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  }, [chartRef, candleSeriesRef, canvasRef]);

  const commit = useCallback((drawing) => {
    drawingsRef.current = [...drawingsRef.current, { id: uid(), ...drawing }];
    previewRef.current  = null;
    stateRef.current    = { phase: 'idle', p1: null };
    setDrawingVersion((v) => v + 1);
    setActiveTool('cursor');
  }, [drawingsRef, previewRef, setActiveTool]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    const w = eventToWorld(e);
    if (!w) return;

    switch (activeTool) {
      case 'hline':
        commit({ type: 'hline', price: w.price });
        break;

      case 'trendline':
        if (stateRef.current.phase === 'idle') {
          stateRef.current   = { phase: 'awaiting-p2', p1: w };
          previewRef.current = { type: 'trendline', price1: w.price, time1: w.time, price2: w.price, time2: w.time };
          onRedraw();
        } else {
          const p1 = stateRef.current.p1;
          commit({ type: 'trendline', price1: p1.price, time1: p1.time, price2: w.price, time2: w.time });
        }
        break;

      case 'rect':
        if (stateRef.current.phase === 'idle') {
          stateRef.current   = { phase: 'dragging', p1: w };
          previewRef.current = { type: 'rect', price1: w.price, time1: w.time, price2: w.price, time2: w.time };
          onRedraw();
        }
        break;

      case 'text': {
        const text = window.prompt('Label:');
        if (text && text.trim()) {
          commit({ type: 'text', price: w.price, time: w.time, text: text.trim() });
        } else {
          setActiveTool('cursor');
        }
        break;
      }

      default:
        break;
    }
  }, [activeTool, commit, eventToWorld, onRedraw, previewRef, setActiveTool]);

  const handleMouseMove = useCallback((e) => {
    const w = eventToWorld(e);
    if (!w) return;

    if (activeTool === 'trendline' && stateRef.current.phase === 'awaiting-p2') {
      previewRef.current = {
        type: 'trendline',
        price1: stateRef.current.p1.price, time1: stateRef.current.p1.time,
        price2: w.price, time2: w.time,
      };
      onRedraw();
    } else if (activeTool === 'rect' && stateRef.current.phase === 'dragging') {
      previewRef.current = {
        type: 'rect',
        price1: stateRef.current.p1.price, time1: stateRef.current.p1.time,
        price2: w.price, time2: w.time,
      };
      onRedraw();
    }
  }, [activeTool, eventToWorld, onRedraw, previewRef]);

  const handleMouseUp = useCallback((e) => {
    if (activeTool === 'rect' && stateRef.current.phase === 'dragging') {
      const w = eventToWorld(e);
      if (!w) return;
      const p1 = stateRef.current.p1;
      commit({ type: 'rect', price1: p1.price, time1: p1.time, price2: w.price, time2: w.time });
    }
  }, [activeTool, commit, eventToWorld]);

  const clearDrawings = useCallback(() => {
    drawingsRef.current = [];
    previewRef.current  = null;
    stateRef.current    = { phase: 'idle', p1: null };
    setDrawingVersion((v) => v + 1);
  }, [drawingsRef, previewRef]);

  return { drawingVersion, handleMouseDown, handleMouseMove, handleMouseUp, clearDrawings };
}
