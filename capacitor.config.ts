import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.fieldmanagerpro',
  appName: 'Field Manager Pro',
  webDir: 'out',
  server: {
    // Points to the live production app — no static build needed.
    // Updates deploy via Vercel as always; no store resubmit required.
    url: 'https://fieldmanagerpro.app',
    cleartext: false,
  },
  plugins: {
    BackgroundGeolocation: {
      // Send GPS pings every 2 minutes while clocked in
      distanceFilter: 50,       // meters moved before a new point is recorded
      stopOnTerminate: false,   // keep tracking even if app is force-closed (Android)
      startOnBoot: false,       // don't auto-start on device reboot
    },
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
