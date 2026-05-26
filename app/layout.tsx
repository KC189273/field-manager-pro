import type { Metadata, Viewport } from 'next'
import './globals.css'
import PushInit from '@/components/PushInit'
import BottomNav from '@/components/BottomNav'

export const metadata: Metadata = {
  title: 'Field Manager Pro',
  description: 'Field team management — time tracking, GPS, scheduling',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet" />
      </head>
      <body className="bg-gray-950 text-white antialiased">
        <PushInit />
        {children}
        <BottomNav />
      </body>
    </html>
  )
}
