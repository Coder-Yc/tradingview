import { useMemo } from 'react';

function formatPrice(p) {
  return typeof p === 'number' ? p.toFixed(1) : p;
}

export default function OrderBookPanel({ orderbook, candles }) {
  const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : null;

  const { bids, asks, maxQty } = useMemo(() => {
    const rawBids = [...(orderbook.bids || [])]
      .map((row) => ({ price: row[0] ?? row.price, qty: row[1] ?? row.qty }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 20);

    const rawAsks = [...(orderbook.asks || [])]
      .map((row) => ({ price: row[0] ?? row.price, qty: row[1] ?? row.qty }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, 20);

    const max = Math.max(1, ...rawBids.map((r) => r.qty), ...rawAsks.map((r) => r.qty));

    return { bids: rawBids, asks: rawAsks, maxQty: max };
  }, [orderbook]);

  const spread = useMemo(() => {
    if (asks.length && bids.length) return (asks[0].price - bids[0].price).toFixed(1);
    return '-';
  }, [asks, bids]);

  const noData = bids.length === 0 && asks.length === 0;

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
        <span style={{ fontWeight: 700, color: '#c9d1d9' }}>ORDER BOOK</span>
        <span>Spread: {spread}</span>
      </div>

      {/* Col headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          padding: '3px 8px',
          fontSize: '10px',
          color: '#6e7681',
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
        }}
      >
        <span>PRICE</span>
        <span style={{ textAlign: 'right' }}>QTY</span>
      </div>

      {noData ? (
        <div style={{ color: '#6e7681', textAlign: 'center', paddingTop: '20px', fontSize: '12px' }}>
          Waiting for orderbook...
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Asks (top, sorted high→low so lowest ask is at bottom) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {[...asks].reverse().map((row, i) => (
              <OrderRow key={`ask-${row.price}`} price={row.price} qty={row.qty} maxQty={maxQty} side="ask" />
            ))}
          </div>

          {/* Mid price */}
          {lastPrice && (
            <div
              style={{
                padding: '4px 8px',
                textAlign: 'center',
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: 'monospace',
                color: '#e6edf3',
                borderTop: '1px solid #30363d',
                borderBottom: '1px solid #30363d',
                background: '#161b22',
                flexShrink: 0,
              }}
            >
              {formatPrice(lastPrice)}
            </div>
          )}

          {/* Bids */}
          <div style={{ flex: 1 }}>
            {bids.map((row, i) => (
              <OrderRow key={`bid-${row.price}`} price={row.price} qty={row.qty} maxQty={maxQty} side="bid" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ price, qty, maxQty, side }) {
  const pct = Math.min(100, (qty / maxQty) * 100);
  const isBid = side === 'bid';
  const barColor = isBid ? 'rgba(38,166,65,0.25)' : 'rgba(248,81,73,0.25)';
  const textColor = isBid ? '#26a641' : '#f85149';

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        padding: '2px 8px',
        fontSize: '12px',
        fontFamily: 'monospace',
        borderBottom: '1px solid #161b22',
      }}
    >
      {/* Background bar */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: barColor,
          pointerEvents: 'none',
        }}
      />
      <span style={{ color: textColor, position: 'relative', zIndex: 1 }}>{formatPrice(price)}</span>
      <span style={{ color: '#c9d1d9', textAlign: 'right', position: 'relative', zIndex: 1 }}>{qty}</span>
    </div>
  );
}
