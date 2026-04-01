import { useEffect, useRef } from 'react';

const PRESET_COLORS = [
  '#e3b341', '#58a6ff', '#3fb950', '#f85149', '#bc8cff',
  '#ff9100', '#ffffff', '#8b949e',
];

const DASH_OPTIONS = [
  { label: 'Solid',  value: '[]' },
  { label: 'Dashed', value: '[6,3]' },
  { label: 'Dotted', value: '[2,3]' },
];

const input = (extra) => ({
  background: '#0d1117', color: '#c9d1d9',
  border: '1px solid #30363d', borderRadius: 3,
  padding: '3px 6px', fontSize: 12, fontFamily: 'monospace',
  outline: 'none', width: '100%',
  ...extra,
});

const label = { fontSize: 11, color: '#8b949e', marginBottom: 3, display: 'block' };

export default function DrawingPropsModal({ editingDrawing, onUpdate, onDelete, onClose }) {
  const panelRef = useRef(null);
  if (!editingDrawing) return null;

  const { drawing, screenX, screenY } = editingDrawing;

  // Close when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Keep panel on screen
  const panelW = 220, panelH = 300;
  const left = Math.min(screenX + 8, window.innerWidth  - panelW - 8);
  const top  = Math.min(screenY + 8, window.innerHeight - panelH - 8);

  const set = (key, val) => onUpdate(drawing.id, { [key]: val });

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', left, top, zIndex: 1000,
        background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
        padding: 12, width: panelW, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3', textTransform: 'uppercase' }}>
          {TYPE_LABEL[drawing.type] ?? drawing.type}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
      </div>

      {/* Color */}
      {drawing.color !== undefined && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Color</span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 5 }}>
            {PRESET_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => set('color', c)}
                style={{
                  width: 18, height: 18, borderRadius: 3, background: c, cursor: 'pointer',
                  border: drawing.color === c ? '2px solid #e6edf3' : '2px solid transparent',
                }}
              />
            ))}
          </div>
          <input type="color" value={drawing.color} onChange={(e) => set('color', e.target.value)}
            style={{ ...input(), width: '100%', height: 24, padding: '2px 4px', cursor: 'pointer' }} />
        </div>
      )}

      {/* Line width (not for VP or text) */}
      {drawing.lineWidth !== undefined && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Line Width: {drawing.lineWidth}px</span>
          <input type="range" min={0.5} max={5} step={0.5} value={drawing.lineWidth}
            onChange={(e) => set('lineWidth', parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }} />
        </div>
      )}

      {/* Dash style */}
      {drawing.dash !== undefined && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Line Style</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {DASH_OPTIONS.map((opt) => {
              const val = JSON.stringify(drawing.dash);
              const active = val === opt.value;
              return (
                <button key={opt.value} onClick={() => set('dash', JSON.parse(opt.value))}
                  style={{
                    flex: 1, padding: '3px 0', fontSize: 10,
                    background: active ? '#1f6feb' : 'transparent',
                    color: active ? '#e6edf3' : '#8b949e',
                    border: `1px solid ${active ? '#1f6feb' : '#30363d'}`, borderRadius: 3, cursor: 'pointer',
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Fill opacity (rect) */}
      {drawing.fillOpacity !== undefined && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Fill Opacity: {Math.round(drawing.fillOpacity * 100)}%</span>
          <input type="range" min={0} max={0.5} step={0.02} value={drawing.fillOpacity}
            onChange={(e) => set('fillOpacity', parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }} />
        </div>
      )}

      {/* Text content */}
      {drawing.type === 'text' && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Text</span>
          <input value={drawing.text} onChange={(e) => set('text', e.target.value)}
            style={input()} />
        </div>
      )}

      {/* Font size */}
      {drawing.fontSize !== undefined && (
        <div style={{ marginBottom: 10 }}>
          <span style={label}>Font Size: {drawing.fontSize}px</span>
          <input type="range" min={8} max={24} step={1} value={drawing.fontSize}
            onChange={(e) => set('fontSize', parseInt(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }} />
        </div>
      )}

      {/* Delete */}
      <button
        onClick={() => onDelete(drawing.id)}
        style={{
          width: '100%', padding: '4px 0', marginTop: 4,
          background: 'rgba(248,81,73,0.1)', color: '#f85149',
          border: '1px solid rgba(248,81,73,0.3)', borderRadius: 3,
          fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
        }}>
        Delete
      </button>
    </div>
  );
}

const TYPE_LABEL = {
  hline:     'Horizontal Line',
  trendline: 'Trend Line',
  rect:      'Rectangle',
  text:      'Text Label',
  vp:        'Volume Profile',
};
