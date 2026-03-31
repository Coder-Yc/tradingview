import { useMemo } from 'react';

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function formatNotional(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}

export default function ClusteredOrdersPanel({ clusteredOrders }) {
  const sorted = useMemo(
    () => [...clusteredOrders].sort((a, b) => b.startTime - a.startTime).slice(0, 150),
    [clusteredOrders]
  );

  const maxNotional = useMemo(
    () => Math.max(1, ...sorted.map((o) => o.totalNotional)),
    [sorted]
  );

  const buyTotal = useMemo(
    () => sorted.filter((o) => o.side === 'buy').reduce((s, o) => s + o.totalNotional, 0),
    [sorted]
  );
  const sellTotal = useMemo(
    () => sorted.filter((o) => o.side === 'sell').reduce((s, o) => s + o.totalNotional, 0),
    [sorted]
  );
  const delta = buyTotal - sellTotal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '6px 8px',
          fontSize: '11px',
          borderBottom: '1px solid #30363d',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, color: '#c9d1d9' }}>CLUSTERED ORDERS</span>
        <span style={{ color: '#26a641' }}>Buy {formatNotional(buyTotal)}</span>
        <span style={{ color: '#f85149' }}>Sell {formatNotional(sellTotal)}</span>
        <span style={{ color: delta >= 0 ? '#26a641' : '#f85149', fontWeight: 700 }}>
          Δ {formatNotional(Math.abs(delta))} {delta >= 0 ? '▲' : '▼'}
        </span>
      </div>

      {/* Col headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '70px 50px 70px 70px 90px 60px 60px 1fr',
          gap: '4px',
          padding: '3px 8px',
          fontSize: '10px',
          color: '#6e7681',
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
        }}
      >
        <span>TIME</span>
        <span>SIDE</span>
        <span style={{ textAlign: 'right' }}>VWAP</span>
        <span style={{ textAlign: 'right' }}>QTY</span>
        <span style={{ textAlign: 'right' }}>NOTIONAL</span>
        <span style={{ textAlign: 'right' }}>TRADES</span>
        <span style={{ textAlign: 'right' }}>RANGE</span>
        <span style={{ paddingLeft: '8px' }}>DIST</span>
      </div>

      {/* Rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sorted.length === 0 ? (
          <div style={{ color: '#6e7681', textAlign: 'center', paddingTop: '12px', fontSize: '12px' }}>
            Waiting for data...
          </div>
        ) : (
          sorted.map((order) => (
            <ClusterRow key={order.id} order={order} maxNotional={maxNotional} />
          ))
        )}
      </div>
    </div>
  );
}

function ClusterRow({ order, maxNotional }) {
  const isBuy = order.side === 'buy';
  const barPct = Math.min(100, (order.totalNotional / maxNotional) * 100);
  const range = (order.maxPrice - order.minPrice).toFixed(1);
  const duration = order.endTime - order.startTime;
  const durationStr = duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`;

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '70px 50px 70px 70px 90px 60px 60px 1fr',
        gap: '4px',
        padding: '3px 8px',
        fontSize: '12px',
        fontFamily: 'monospace',
        borderBottom: '1px solid #21262d',
        backgroundColor: isBuy ? 'rgba(38,166,65,0.04)' : 'rgba(248,81,73,0.04)',
        alignItems: 'center',
      }}
    >
      <span style={{ color: '#8b949e' }}>{formatTime(order.startTime)}</span>
      <span style={{ color: isBuy ? '#26a641' : '#f85149', fontWeight: 700 }}>
        {isBuy ? '▲ BUY' : '▼ SELL'}
      </span>
      <span style={{ color: '#c9d1d9', textAlign: 'right' }}>{order.vwap.toFixed(1)}</span>
      <span style={{ color: '#c9d1d9', textAlign: 'right' }}>{order.totalQuantity}</span>
      <span style={{ color: '#e6edf3', textAlign: 'right', fontWeight: 600 }}>
        {formatNotional(order.totalNotional)}
      </span>
      <span style={{ color: '#8b949e', textAlign: 'right' }}>{order.trades}</span>
      <span style={{ color: '#8b949e', textAlign: 'right' }}>{range}</span>
      {/* Bar */}
      <div style={{ paddingLeft: '8px', position: 'relative' }}>
        <div
          style={{
            height: '8px',
            width: `${barPct}%`,
            background: isBuy
              ? 'linear-gradient(90deg, #26a641, #3fb950)'
              : 'linear-gradient(90deg, #f85149, #da3633)',
            borderRadius: '2px',
            minWidth: '2px',
          }}
        />
        <span style={{ fontSize: '9px', color: '#6e7681', marginLeft: '4px' }}>{durationStr}</span>
      </div>
    </div>
  );
}
