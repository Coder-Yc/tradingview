import { useState } from 'react';
import useMarketData from './hooks/useMarketData';
import Chart from './components/Chart';

const SYMBOLS = [
  { value: 'GC',  label: 'GC  · Gold' },
  { value: 'SI',  label: 'SI  · Silver' },
  { value: 'CL',  label: 'CL  · Crude Oil' },
  { value: 'NQ',  label: 'NQ  · Nasdaq' },
  { value: 'ES',  label: 'ES  · S&P 500' },
  { value: 'ZN',  label: 'ZN  · 10Y Note' },
  { value: 'ZB',  label: 'ZB  · 30Y Bond' },
];

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

const STATUS_COLOR = {
  connected:    '#26a641',
  connecting:   '#e3b341',
  disconnected: '#8b949e',
  error:        '#f85149',
};

const selectStyle = {
  background:  '#161b22',
  color:       '#c9d1d9',
  border:      '1px solid #30363d',
  borderRadius: 4,
  padding:     '3px 8px',
  fontSize:    12,
  fontFamily:  'monospace',
  cursor:      'pointer',
  outline:     'none',
};

export default function App() {
  const [symbol,    setSymbol]    = useState('GC');
  const [timeframe, setTimeframe] = useState('5m');

  const { status, candles, bigTrades, symbolInfo, footprintRef, footprintVersion } =
    useMarketData({ symbol, timeframe });

  const lastCandle = candles.at(-1);
  const prevCandle = candles.at(-2);
  const priceChange = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : 0;
  const pricePct    = prevCandle ? ((priceChange / prevCandle.close) * 100).toFixed(2) : '0.00';
  const priceColor  = priceChange >= 0 ? '#26a641' : '#f85149';

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0d1117', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, height: 44, background: '#161b22',
        borderBottom: '1px solid #30363d',
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12,
      }}>

        {/* Symbol selector */}
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={selectStyle}>
          {SYMBOLS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Timeframe pills */}
        <div style={{ display: 'flex', gap: 3 }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                background:   tf === timeframe ? '#1f6feb' : 'transparent',
                color:        tf === timeframe ? '#e6edf3' : '#8b949e',
                border:       `1px solid ${tf === timeframe ? '#1f6feb' : '#30363d'}`,
                borderRadius: 4, padding: '2px 8px', fontSize: 11,
                fontFamily: 'monospace', cursor: 'pointer',
              }}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: '#30363d' }} />

        {/* Price display */}
        {lastCandle && (
          <>
            <span style={{ fontSize: 18, fontWeight: 700, color: priceColor, fontFamily: 'monospace' }}>
              {lastCandle.close.toFixed(1)}
            </span>
            <span style={{ fontSize: 12, color: priceColor }}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(1)} ({pricePct}%)
            </span>
            <span style={{ fontSize: 11, color: '#6e7681', display: 'flex', gap: 10 }}>
              <span>O <b style={{ color: '#c9d1d9' }}>{lastCandle.open.toFixed(1)}</b></span>
              <span>H <b style={{ color: '#3fb950' }}>{lastCandle.high.toFixed(1)}</b></span>
              <span>L <b style={{ color: '#f85149' }}>{lastCandle.low.toFixed(1)}</b></span>
              <span>V <b style={{ color: '#c9d1d9' }}>{lastCandle.volume}</b></span>
              <span>δ <b style={{ color: (lastCandle.buyVolume - lastCandle.sellVolume) >= 0 ? '#3fb950' : '#f85149' }}>
                {lastCandle.buyVolume - lastCandle.sellVolume}
              </b></span>
            </span>
          </>
        )}

        {/* Connection status */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: STATUS_COLOR[status],
            boxShadow: status === 'connected' ? '0 0 6px #26a641' : 'none',
            display: 'inline-block',
          }} />
          <span style={{ color: STATUS_COLOR[status], textTransform: 'uppercase', letterSpacing: 1 }}>
            {status}
          </span>
        </div>
      </div>

      {/* ── Chart (full remaining height) ───────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Chart
          candles={candles}
          bigTrades={bigTrades}
          footprintRef={footprintRef}
          footprintVersion={footprintVersion}
        />
      </div>
    </div>
  );
}
