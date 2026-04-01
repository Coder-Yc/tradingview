import { useState, useEffect } from 'react';

const STORAGE_KEY = 'chart_templates_v1';

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveTemplates(tpls) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tpls));
}

export default function TemplatePanel({ symbol, timeframe, indicators, showVP, onLoad }) {
  const [open,      setOpen]      = useState(false);
  const [templates, setTemplates] = useState(loadTemplates);
  const [saveName,  setSaveName]  = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => { saveTemplates(templates); }, [templates]);

  const handleSave = () => {
    const name = saveName.trim() || `${symbol} ${timeframe} ${new Date().toLocaleTimeString()}`;
    const tpl = { id: Date.now().toString(36), name, symbol, timeframe, indicators, showVP };
    setTemplates((prev) => [...prev.filter((t) => t.name !== name), tpl]);
    setSaveName('');
    setSaving(false);
  };

  const handleLoad = (tpl) => {
    onLoad(tpl);
    setOpen(false);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const pill = {
    background: open ? '#1f6feb22' : 'transparent',
    color: templates.length > 0 ? '#c9d1d9' : '#8b949e',
    border: `1px solid ${open ? '#1f6feb' : '#30363d'}`,
    borderRadius: 4, padding: '2px 8px', fontSize: 11,
    fontFamily: 'monospace', cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => { setOpen((v) => !v); setSaving(false); }} style={pill}>
        {templates.length > 0 ? `Templates (${templates.length})` : 'Templates'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
          background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
          padding: 10, minWidth: 220, maxHeight: 400, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontSize: 9, color: '#6e7681', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Templates
          </div>

          {templates.length === 0 && (
            <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 8 }}>No saved templates</div>
          )}

          {templates.map((tpl) => (
            <div
              key={tpl.id}
              onClick={() => handleLoad(tpl)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 8px', marginBottom: 3, borderRadius: 4,
                background: '#21262d', cursor: 'pointer', gap: 8,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#2d333b')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#21262d')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#c9d1d9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tpl.name}
                </div>
                <div style={{ fontSize: 10, color: '#6e7681', marginTop: 1 }}>
                  {tpl.symbol} · {tpl.timeframe} · {tpl.indicators?.filter((i) => i.enabled).length ?? 0} ind
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(tpl.id, e)}
                style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
              >×</button>
            </div>
          ))}

          <div style={{ height: 1, background: '#30363d', margin: '8px 0' }} />

          {saving ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus
                placeholder={`${symbol} ${timeframe}`}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSaving(false); }}
                style={{
                  flex: 1, background: '#0d1117', color: '#c9d1d9',
                  border: '1px solid #30363d', borderRadius: 3,
                  padding: '3px 6px', fontSize: 11, fontFamily: 'monospace', outline: 'none',
                }}
              />
              <button
                onClick={handleSave}
                style={{
                  background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 3,
                  padding: '3px 8px', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                }}
              >Save</button>
            </div>
          ) : (
            <button
              onClick={() => setSaving(true)}
              style={{
                width: '100%', padding: '4px 0', background: '#21262d',
                color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4,
                fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
              }}
            >+ Save Current</button>
          )}
        </div>
      )}
    </div>
  );
}
