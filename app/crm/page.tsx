'use client'

export default function CrmPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0D1220',
        color: '#F5F3EE',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
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
  )
}
