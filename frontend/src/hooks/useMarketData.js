import { useEffect, useRef, useState, useCallback } from 'react';
import { encode, decode } from '@msgpack/msgpack';

const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NTYsImVtYWlsIjoieWFuZ2Nob25nNDM0QGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzc0OTU3NzMzLCJleHAiOjE3NzU1NjI1MzN9.atKllqHGDdhEw1W-pQyzNTfvOVndWp3c2K2YQ5dzJpI';
const WS_URL = `wss://nexflow-tech.xyz/ws?token=${TOKEN}`;

// Minimum quantity (contracts/lots) per symbol to count as a "big trade"
const BIG_TRADE_MIN_QTY = {
  ES: 50, NQ: 30, GC: 30, SI: 20, CL: 20, ZN: 50, ZB: 20,
};

export default function useMarketData({ symbol = 'GC', timeframe = '5m' } = {}) {
  const wsRef          = useRef(null);
  const reconnectTimer = useRef(null);
  const paramsRef      = useRef({ symbol, timeframe });

  const [status, setStatus]           = useState('disconnected');
  const [candles, setCandles]         = useState([]);
  const [bigTrades, setBigTrades]     = useState([]);
  const [symbolInfo, setSymbolInfo]   = useState(null);

  // footprintRef: Map<candleTimeS, {
  //   open,high,low,close,volume,trades,buyVol,sellVol,poc,delta,isCurrent,
  //   levels: Map<priceStr, {sell,buy,trades}>
  // }>
  const footprintRef = useRef(new Map());
  const [footprintVersion, setFootprintVersion] = useState(0);

  useEffect(() => { paramsRef.current = { symbol, timeframe }; }, [symbol, timeframe]);

  // ── Build subscriptions ────────────────────────────────────────────────────
  const buildSubs = ({ symbol, timeframe }) => [
    { type: 'subscribe', channel: 'candles',
      params: { exchange: 'databento', symbol, timeframe, candleCount: 500 } },
    { type: 'subscribe', channel: 'big_trades',
      params: { exchange: 'databento', symbol, timeframe, bigTradeThreshold: 10000, lookbackCandles: 500 } },
    { type: 'subscribe', channel: 'footprint',
      params: { exchange: 'databento', symbol, timeframe, candleCount: 500 } },
  ];

  // ── Parse footprint_history candle array ───────────────────────────────────
  // [timeMs, open, high, low, close, vol, trades, buyVol, sellVol, tickSize, poc, delta, isCurrent, levels]
  function parseHistoryCandle(c) {
    const [timeMs, open, high, low, close, volume, trades, buyVol, sellVol, , poc, delta, isCurrent, rawLevels] = c;
    const levels = new Map();
    if (Array.isArray(rawLevels)) {
      for (const [price, sell, buy, t] of rawLevels) {
        levels.set(price.toFixed(1), { sell: sell || 0, buy: buy || 0, trades: t || 0 });
      }
    }
    return { open, high, low, close, volume, trades, buyVol, sellVol, poc, delta, isCurrent, levels };
  }

  // ── Parse footprint_delta array ────────────────────────────────────────────
  // [timeMs, open, high, low, close, vol, trades, buyVol, sellVol, poc, delta, isCurrent, changedLevels, seq]
  function applyDelta(d) {
    const [timeMs, open, high, low, close, volume, trades, buyVol, sellVol, poc, delta, isCurrent, changedLevels] = d;
    const candleTimeS = Math.floor(timeMs / 1000);
    const existing = footprintRef.current.get(candleTimeS);
    const levels = existing ? existing.levels : new Map();

    if (Array.isArray(changedLevels)) {
      for (const [price, sell, buy, t] of changedLevels) {
        const pk   = price.toFixed(1);
        const prev = levels.get(pk) || { sell: 0, buy: 0, trades: 0 };
        levels.set(pk, { sell: prev.sell + (sell || 0), buy: prev.buy + (buy || 0), trades: prev.trades + (t || 0) });
      }
    }

    footprintRef.current.set(candleTimeS, { open, high, low, close, volume, trades, buyVol, sellVol, poc, delta, isCurrent, levels });
    setFootprintVersion((v) => v + 1);
  }

  // ── Message handler ────────────────────────────────────────────────────────
  function handleMessage(data) {
    switch (data.type) {
      case 'history':
        setCandles(data.data.map((c) => ({
          time: Math.floor(c.time / 1000),
          open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume, buyVolume: c.buyVolume, sellVolume: c.sellVolume, trades: c.trades,
        })));
        break;

      case 'candle':
      case 'candle_update':
        setCandles((prev) => {
          const c   = data.data;
          const upd = {
            time: Math.floor(c.time / 1000),
            open: c.open, high: c.high, low: c.low, close: c.close,
            volume: c.volume, buyVolume: c.buyVolume, sellVolume: c.sellVolume, trades: c.trades,
          };
          const idx = prev.findIndex((x) => x.time === upd.time);
          if (idx >= 0) { const n = [...prev]; n[idx] = upd; return n; }
          return [...prev, upd];
        });
        break;

      case 'footprint_history': {
        const fp = new Map();
        for (const c of data.data) {
          const timeS = Math.floor(c[0] / 1000);
          fp.set(timeS, parseHistoryCandle(c));
        }
        footprintRef.current = fp;
        setFootprintVersion((v) => v + 1);
        break;
      }

      case 'footprint_delta':
        if (Array.isArray(data.data)) applyDelta(data.data);
        break;

      case 'big_trade_history': {
        const minQty = BIG_TRADE_MIN_QTY[paramsRef.current.symbol] ?? 10;
        setBigTrades(data.data.filter((t) => t.quantity >= minQty).slice().reverse());
        break;
      }

      case 'big_trade': {
        const minQty = BIG_TRADE_MIN_QTY[paramsRef.current.symbol] ?? 10;
        if (data.data.quantity >= minQty) {
          setBigTrades((prev) => [data.data, ...prev].slice(0, 500));
        }
        break;
      }

      case 'symbol_info':
        setSymbolInfo(data.data);
        break;

      case 'subscribed':
        console.log('✓ subscribed:', data.channel);
        break;

      default:
        break;
    }
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    ws.binaryType  = 'arraybuffer';
    wsRef.current  = ws;

    ws.onopen = () => {
      setStatus('connected');
      buildSubs(paramsRef.current).forEach((msg) => ws.send(encode(msg)));
    };
    ws.onmessage = (event) => {
      try { handleMessage(decode(new Uint8Array(event.data))); }
      catch (e) { console.error('decode error', e); }
    };
    ws.onerror  = () => setStatus('error');
    ws.onclose  = () => {
      setStatus('disconnected');
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, []);

  // Re-connect + clear when symbol/timeframe changes
  useEffect(() => {
    footprintRef.current = new Map();
    setFootprintVersion(0);
    setCandles([]);
    setBigTrades([]);
    setSymbolInfo(null);
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [symbol, timeframe, connect]);

  return { status, candles, bigTrades, symbolInfo, footprintRef, footprintVersion };
}
