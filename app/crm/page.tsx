'use client'

export default function CrmPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0D1220',
        color: '#F5F3EE',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          height: 48,
          minHeight: 48,
          borderBottom: '0.5px solid #1E2535',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              color: '#EF9F27',
              fontFamily: 'monospace',
              fontSize: 13,
              letterSpacing: '0.12em',
              fontWeight: 600,
            }}
          >
            MINERAL MAP
          </div>
          <a
            href="/"
            style={{
              color: '#7A7870',
              fontSize: 11,
              textDecoration: 'none',
              border: '0.5px solid #2A2F3E',
              borderRadius: 999,
              padding: '3px 10px',
            }}
          >
            ← Map
          </a>
        </div>
        <div style={{ color: '#F5F3EE', fontSize: 12, fontWeight: 600 }}>CRM & Pipeline</div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              color: '#EF9F27',
              fontFamily: 'monospace',
              fontSize: 16,
              letterSpacing: '0.12em',
              marginBottom: 8,
            }}
          >
            CRM & PIPELINE
          </div>
          <div style={{ color: '#7A7870', fontSize: 12 }}>
            Deal management page is available here.
          </div>
        </div>
      </div>
    </div>
  )
}
