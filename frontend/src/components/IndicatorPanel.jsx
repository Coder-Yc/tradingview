import { useState } from 'react';

const CATALOG = [
  { type: 'bigtrades',          label: 'Big Trades',          category: 'Volume',    params: {} },
  { type: 'ema',                label: 'EMA',                 category: 'Overlay',   params: { period: 20, color: '#f0a500' } },
  { type: 'sma',                label: 'SMA',                 category: 'Overlay',   params: { period: 20, color: '#38bdf8' } },
  { type: 'bollinger',          label: 'Bollinger Bands',      category: 'Overlay',   params: { period: 20, stdDev: 2, color: '#c084fc' } },
  { type: 'vwap',               label: 'VWAP',                category: 'Overlay',   params: { color: '#fb923c' } },
  { type: 'cvd',                label: 'CVD',                 category: 'Volume',    params: { color: '#34d399' } },
  { type: 'fvg',                label: 'FVG',                 category: 'Pattern',   params: { minGap: 0.5 } },
  { type: 'inside-bar',         label: 'Inside Bar',          category: 'Pattern',   params: {} },
  { type: 'stacked-imbalance',  label: 'Stacked Imbalance',   category: 'Footprint', params: { threshold: 3, stackCount: 3 } },
  { type: 'session-vp',         label: 'Session VP',          category: 'VP',        params: {} },
  { type: 'key-levels',         label: 'Key Levels',          category: 'VP',        params: { lookback: 100 } },
  { type: 'bar-timer',          label: 'Bar Timer',           category: 'Misc',      params: {} },
];

const MULTI_ALLOWED = new Set(['ema', 'sma', 'bollinger', 'vwap', 'cvd']);

const CAT_ORDER = ['Overlay', 'Volume', 'Pattern', 'Footprint', 'VP', 'Misc'];

let _uid = 0;
const uid = () => `ind-${++_uid}-${Date.now().toString(36)}`;

const s = {
  input: {
    background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
    borderRadius: 3, padding: '2px 5px', fontSize: 11, fontFamily: 'monospace',
    outline: 'none', width: 52,
  },
  label: { fontSize: 11, color: '#8b949e', marginRight: 4 },
};

function ParamRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={s.label}>{label}</span>
      {children}
    </div>
  );
}

function IndConfig({ ind, onChange }) {
  const p = ind.params;
  const set = (key, val) => onChange({ params: { ...p, [key]: val } });
  return (
    <div style={{ padding: '6px 8px', background: '#0d1117', borderRadius: 4, marginTop: 4 }}>
      {p.period !== undefined && (
        <ParamRow label="Period">
          <input type="number" style={s.input} value={p.period} min={1} max={500}
            onChange={(e) => set('period', parseInt(e.target.value) || p.period)} />
        </ParamRow>
      )}
      {p.stdDev !== undefined && (
        <ParamRow label="StdDev">
          <input type="number" style={s.input} value={p.stdDev} min={0.5} max={5} step={0.5}
            onChange={(e) => set('stdDev', parseFloat(e.target.value) || p.stdDev)} />
        </ParamRow>
      )}
      {p.color !== undefined && (
        <ParamRow label="Color">
          <input type="color" style={{ width: 32, height: 22, padding: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 3, cursor: 'pointer' }}
            value={p.color} onChange={(e) => set('color', e.target.value)} />
        </ParamRow>
      )}
      {p.minGap !== undefined && (
        <ParamRow label="Min Gap">
          <input type="number" style={s.input} value={p.minGap} min={0.1} step={0.1}
            onChange={(e) => set('minGap', parseFloat(e.target.value) || p.minGap)} />
        </ParamRow>
      )}
      {p.threshold !== undefined && (
        <ParamRow label="Ratio">
          <input type="number" style={s.input} value={p.threshold} min={1.5} step={0.5}
            onChange={(e) => set('threshold', parseFloat(e.target.value) || p.threshold)} />
        </ParamRow>
      )}
      {p.stackCount !== undefined && (
        <ParamRow label="Stack">
          <input type="number" style={s.input} value={p.stackCount} min={2} max={10}
            onChange={(e) => set('stackCount', parseInt(e.target.value) || p.stackCount)} />
        </ParamRow>
      )}
      {p.lookback !== undefined && (
        <ParamRow label="Lookback">
          <input type="number" style={s.input} value={p.lookback} min={10} max={1000}
            onChange={(e) => set('lookback', parseInt(e.target.value) || p.lookback)} />
        </ParamRow>
      )}
    </div>
  );
}

export default function IndicatorPanel({ indicators, setIndicators }) {
  const [open,       setOpen]       = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [expandedId,  setExpandedId]  = useState(null);

  const toggle = (id) =>
    setIndicators((prev) => prev.map((ind) => ind.id === id ? { ...ind, enabled: !ind.enabled } : ind));
  const remove = (id) =>
    setIndicators((prev) => prev.filter((ind) => ind.id !== id));
  const update = (id, patch) =>
    setIndicators((prev) => prev.map((ind) => ind.id === id ? { ...ind, ...patch } : ind));

  const addFromCatalog = (entry) => {
    const alreadyExists = indicators.some((i) => i.type === entry.type);
    if (alreadyExists && !MULTI_ALLOWED.has(entry.type)) return;
    setIndicators((prev) => [
      ...prev,
      { id: uid(), type: entry.type, label: entry.label, params: { ...entry.params }, enabled: true },
    ]);
    setShowCatalog(false);
  };

  const activeCount = indicators.filter((i) => i.enabled).length;

  const grouped = CAT_ORDER.reduce((acc, cat) => {
    const inds = indicators.filter((i) => {
      const entry = CATALOG.find((c) => c.type === i.type);
      return entry?.category === cat;
    });
    if (inds.length) acc.push({ cat, inds });
    return acc;
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen((v) => !v); setShowCatalog(false); }}
        style={{
          background: open ? '#1f6feb' : 'transparent',
          color: activeCount > 0 ? (open ? '#e6edf3' : '#c9d1d9') : '#8b949e',
          border: `1px solid ${open ? '#1f6feb' : '#30363d'}`,
          borderRadius: 4, padding: '2px 8px', fontSize: 11,
          fontFamily: 'monospace', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {activeCount > 0 ? `Ind (${activeCount})` : 'Indicators'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
          background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
          padding: 10, minWidth: 240, maxHeight: 480, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}>
          {/* Active indicators grouped by category */}
          {grouped.map(({ cat, inds }) => (
            <div key={cat}>
              <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 6 }}>
                {cat}
              </div>
              {inds.map((ind) => {
                const expanded = expandedId === ind.id;
                return (
                  <div key={ind.id} style={{ marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox" checked={ind.enabled}
                        onChange={() => toggle(ind.id)}
                        style={{ accentColor: ind.params?.color || '#58a6ff', cursor: 'pointer' }}
                      />
                      <span
                        onClick={() => setExpandedId(expanded ? null : ind.id)}
                        style={{
                          flex: 1, fontSize: 12, fontFamily: 'monospace',
                          color: ind.params?.color || '#c9d1d9', cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        {ind.label}
                      </span>
                      <button
                        onClick={() => setExpandedId(expanded ? null : ind.id)}
                        title="Settings"
                        style={{ background:'none', border:'none', color: expanded ? '#58a6ff' : '#6e7681', cursor:'pointer', fontSize:12, padding:'0 2px' }}
                      >⚙</button>
                      <button
                        onClick={() => remove(ind.id)}
                        title="Remove"
                        style={{ background:'none', border:'none', color:'#6e7681', cursor:'pointer', fontSize:14, padding:'0 2px', lineHeight:1 }}
                      >×</button>
                    </div>
                    {expanded && (
                      <IndConfig ind={ind} onChange={(patch) => update(ind.id, patch)} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {indicators.length === 0 && (
            <div style={{ fontSize: 11, color: '#6e7681', textAlign: 'center', padding: '8px 0' }}>
              No indicators added
            </div>
          )}

          {/* Add button */}
          <div style={{ height: 1, background: '#30363d', margin: '8px 0' }} />
          <button
            onClick={() => setShowCatalog((v) => !v)}
            style={{
              width: '100%', padding: '4px 0', background: showCatalog ? '#1f6feb22' : '#21262d',
              color: '#c9d1d9', border: `1px solid ${showCatalog ? '#1f6feb' : '#30363d'}`,
              borderRadius: 4, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            + Add Indicator
          </button>

          {showCatalog && (
            <div style={{ marginTop: 6 }}>
              {CAT_ORDER.map((cat) => {
                const entries = CATALOG.filter((e) => e.category === cat);
                if (!entries.length) return null;
                return (
                  <div key={cat}>
                    <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 1, margin: '6px 0 3px' }}>{cat}</div>
                    {entries.map((entry) => {
                      const alreadyHas = indicators.some((i) => i.type === entry.type);
                      const canAdd = !alreadyHas || MULTI_ALLOWED.has(entry.type);
                      return (
                        <button
                          key={entry.type}
                          onClick={() => canAdd && addFromCatalog(entry)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '3px 8px', marginBottom: 2, fontSize: 11, fontFamily: 'monospace',
                            background: 'transparent', color: canAdd ? '#c9d1d9' : '#6e7681',
                            border: '1px solid transparent', borderRadius: 3, cursor: canAdd ? 'pointer' : 'default',
                          }}
                          onMouseEnter={(e) => canAdd && (e.target.style.background = '#21262d')}
                          onMouseLeave={(e) => (e.target.style.background = 'transparent')}
                        >
                          {entry.label} {alreadyHas && !MULTI_ALLOWED.has(entry.type) ? '✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
