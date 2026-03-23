import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Field Manager Pro',
  description: 'Field team management — time tracking, GPS, scheduling',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet" />
      </head>
      <body className="min-h-full bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
