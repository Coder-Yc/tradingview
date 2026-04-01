const TOOLS = [
  { id: 'cursor',    label: '↖', title: 'Cursor' },
  { id: 'hline',     label: '—', title: 'Horizontal Line' },
  { id: 'trendline', label: '╱', title: 'Trend Line' },
  { id: 'rect',      label: '□', title: 'Rectangle' },
  { id: 'text',      label: 'T', title: 'Text' },
  { id: 'vp',        label: 'VP', title: 'Fixed Range Volume Profile (drag to select range)' },
];

export default function DrawingToolbar({ activeTool, setActiveTool, onClearDrawings }) {
  return (
    <div style={{
      flexShrink: 0, width: 36,
      background: '#161b22',
      borderRight: '1px solid #30363d',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', paddingTop: 8, gap: 4,
    }}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.title}
          onClick={() => setActiveTool(t.id)}
          style={{
            width: 28, height: 28,
            background:   t.id === activeTool ? '#1f6feb' : 'transparent',
            color:        t.id === activeTool ? '#e6edf3' : '#8b949e',
            border:       `1px solid ${t.id === activeTool ? '#1f6feb' : '#30363d'}`,
            borderRadius: 4,
            fontSize: t.id === 'text' ? 13 : 15,
            fontFamily: 'monospace',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          {t.label}
        </button>
      ))}

      {/* Divider */}
      <div style={{ width: 20, height: 1, background: '#30363d', margin: '4px 0' }} />

      {/* Clear drawings */}
      <button
        title="Clear all drawings"
        onClick={onClearDrawings}
        style={{
          width: 28, height: 28,
          background: 'transparent', color: '#8b949e',
          border: '1px solid #30363d', borderRadius: 4,
          fontSize: 13, fontFamily: 'monospace', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
