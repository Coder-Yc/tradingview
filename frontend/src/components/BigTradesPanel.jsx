import { useMemo } from 'react';

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function formatNotional(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function TradeRow({ trade }) {
  const isBuy = trade.side === 'buy';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 80px 50px 90px 50px',
        gap: '4px',
        padding: '3px 8px',
        fontSize: '12px',
        fontFamily: 'monospace',
        borderBottom: '1px solid #21262d',
        backgroundColor: isBuy ? 'rgba(38,166,65,0.06)' : 'rgba(248,81,73,0.06)',
        alignItems: 'center',
      }}
    >
      <span style={{ color: '#8b949e' }}>{formatTime(trade.timestamp)}</span>
      <span style={{ color: '#c9d1d9', textAlign: 'right' }}>{trade.price.toFixed(1)}</span>
      <span style={{ color: '#c9d1d9', textAlign: 'right' }}>{trade.quantity}</span>
      <span style={{ color: '#c9d1d9', textAlign: 'right' }}>{formatNotional(trade.notional)}</span>
      <span
        style={{
          color: isBuy ? '#26a641' : '#f85149',
          fontWeight: 700,
          textAlign: 'center',
          letterSpacing: '0.5px',
        }}
      >
        {isBuy ? '▲ B' : '▼ S'}
      </span>
    </div>
  );
}

export default function BigTradesPanel({ bigTrades }) {
  const buyCount = useMemo(() => bigTrades.filter((t) => t.side === 'buy').length, [bigTrades]);
  const sellCount = bigTrades.length - buyCount;
  const buyNotional = useMemo(
    () => bigTrades.filter((t) => t.side === 'buy').reduce((s, t) => s + t.notional, 0),
    [bigTrades]
  );
  const sellNotional = useMemo(
    () => bigTrades.filter((t) => t.side === 'sell').reduce((s, t) => s + t.notional, 0),
    [bigTrades]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '6px 8px',
          fontSize: '11px',
          color: '#8b949e',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, color: '#c9d1d9' }}>BIG TRADES</span>
        <span>
          <span style={{ color: '#26a641' }}>{buyCount}B {formatNotional(buyNotional)}</span>
          {' / '}
          <span style={{ color: '#f85149' }}>{sellCount}S {formatNotional(sellNotional)}</span>
        </span>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 80px 50px 90px 50px',
          gap: '4px',
          padding: '3px 8px',
          fontSize: '10px',
          color: '#6e7681',
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
        }}
      >
        <span>TIME</span>
        <span style={{ textAlign: 'right' }}>PRICE</span>
        <span style={{ textAlign: 'right' }}>QTY</span>
        <span style={{ textAlign: 'right' }}>NOTIONAL</span>
        <span style={{ textAlign: 'center' }}>SIDE</span>
      </div>

      {/* Rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {bigTrades.length === 0 ? (
          <div style={{ color: '#6e7681', textAlign: 'center', paddingTop: '20px', fontSize: '12px' }}>
            Waiting for data...
          </div>
        ) : (
          bigTrades.slice(0, 200).map((t, i) => <TradeRow key={t.tradeId || i} trade={t} />)
        )}
      </div>
    </div>
  );
}
