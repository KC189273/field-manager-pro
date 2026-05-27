'use client'

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: '#030712', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ textAlign: 'center', maxWidth: '320px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(127,29,29,0.4)', border: '1px solid #b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#f87171" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p style={{ color: '#9ca3af', marginBottom: 20, fontSize: 14, lineHeight: 1.5 }}>
              Something went wrong. Please refresh the page.
            </p>
            <button
              onClick={reset}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
