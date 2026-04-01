import { useState } from 'react';

// Cycling colors for EMA lines
const EMA_COLORS = ['#f0a500', '#38bdf8', '#c084fc', '#f87171', '#34d399', '#fb923c', '#a3e635'];

const inputStyle = {
  background: '#0d1117', color: '#c9d1d9',
  border: '1px solid #30363d', borderRadius: 4,
  padding: '3px 6px', fontSize: 11, fontFamily: 'monospace',
  outline: 'none', width: 64,
};

export default function IndicatorPanel({ indicators, setIndicators }) {
  const [open,      setOpen]      = useState(false);
  const [newPeriod, setNewPeriod] = useState('');

  const toggle = (id) =>
    setIndicators((prev) => prev.map((ind) => ind.id === id ? { ...ind, enabled: !ind.enabled } : ind));

  const remove = (id) =>
    setIndicators((prev) => prev.filter((ind) => ind.id !== id));

  const addEMA = () => {
    const period = parseInt(newPeriod, 10);
    if (!period || period < 1 || period > 500) return;
    const emaCount = indicators.filter((i) => i.type === 'ema').length;
    setIndicators((prev) => [
      ...prev,
      {
        id: `ema-${Date.now()}`,
        type: 'ema',
        label: `EMA ${period}`,
        params: { period, color: EMA_COLORS[emaCount % EMA_COLORS.length] },
        enabled: true,
      },
    ]);
    setNewPeriod('');
  };

  const emaIndicators = indicators.filter((i) => i.type === 'ema');
  const btIndicator   = indicators.find((i) => i.type === 'bigtrades');

  const activeCount = indicators.filter((i) => i.enabled).length;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background:   open ? '#1f6feb' : 'transparent',
          color:        activeCount > 0 ? (open ? '#e6edf3' : '#c9d1d9') : '#8b949e',
          border:       `1px solid ${open ? '#1f6feb' : '#30363d'}`,
          borderRadius: 4, padding: '2px 8px', fontSize: 11,
          fontFamily: 'monospace', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {activeCount > 0 ? `Ind (${activeCount})` : 'Indicators'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
            background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
            padding: 12, minWidth: 230, boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
          // Close when clicking outside
          onMouseLeave={() => {}}
        >
          <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            Indicators
          </div>

          {/* Big Trades toggle */}
          {btIndicator && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '4px 0' }}>
              <input
                type="checkbox"
                id="bt-toggle"
                checked={btIndicator.enabled}
                onChange={() => toggle(btIndicator.id)}
                style={{ accentColor: '#26a641', cursor: 'pointer' }}
              />
              <label htmlFor="bt-toggle" style={{ fontSize: 12, color: '#c9d1d9', fontFamily: 'monospace', cursor: 'pointer', flex: 1 }}>
                Big Trades
              </label>
              <span style={{ fontSize: 10, color: '#26a641' }}>●</span>
            </div>
          )}

          {/* Divider */}
          {emaIndicators.length > 0 && (
            <div style={{ height: 1, background: '#30363d', margin: '6px 0' }} />
          )}

          {/* EMA list */}
          {emaIndicators.map((ind) => (
            <div key={ind.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <input
                type="checkbox"
                id={`ind-${ind.id}`}
                checked={ind.enabled}
                onChange={() => toggle(ind.id)}
                style={{ accentColor: ind.params.color, cursor: 'pointer' }}
              />
              <label
                htmlFor={`ind-${ind.id}`}
                style={{ fontSize: 12, fontFamily: 'monospace', color: ind.params.color, cursor: 'pointer', flex: 1 }}
              >
                {ind.label}
              </label>
              <button
                onClick={() => remove(ind.id)}
                title="Remove"
                style={{
                  background: 'transparent', color: '#6e7681', border: 'none',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px',
                }}
              >
                ×
              </button>
            </div>
          ))}

          {/* Add EMA */}
          <div style={{ height: 1, background: '#30363d', margin: '8px 0' }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Period"
              value={newPeriod}
              min={1} max={500}
              onChange={(e) => setNewPeriod(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEMA()}
              style={inputStyle}
            />
            <button
              onClick={addEMA}
              style={{
                flex: 1, background: '#21262d', color: '#c9d1d9',
                border: '1px solid #30363d', borderRadius: 4,
                padding: '3px 8px', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
              }}
            >
              + EMA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
