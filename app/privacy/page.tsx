export const metadata = {
  title: 'Privacy Policy – Field Manager Pro',
  description: 'Privacy Policy for Field Manager Pro, including how we collect and use background location data.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300 px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: May 21, 2026</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
        <p>Field Manager Pro (&quot;the App&quot;) is a field team management application used by businesses to manage hourly employees and field teams. This Privacy Policy explains what data we collect, why we collect it, and how it is used and protected.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Information We Collect</h2>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Account information:</strong> Your name and login credentials, provided by your employer when your account is created.</li>
          <li><strong>Background location data:</strong> GPS coordinates collected continuously while you have an active work shift — including when the app is closed or not in use — to verify your clock-in location and log your work route. See the Location Data section below for full details.</li>
          <li><strong>Clock records:</strong> Clock-in and clock-out times and locations.</li>
          <li><strong>Form submissions:</strong> Data entered into store visit reports, checklists, and expense forms as part of your job duties.</li>
          <li><strong>Photos:</strong> Images uploaded as part of visit reports, facility tickets, or expense submissions.</li>
          <li><strong>Push notification tokens:</strong> Device tokens used to send work-related push notifications from your employer.</li>
        </ul>
      </section>

      {/* ===== LOCATION DATA — kept prominent per Google Play policy requirements ===== */}
      <section className="mb-8 border border-gray-700 rounded-xl p-5 bg-gray-900/50">
        <h2 className="text-xl font-semibold text-white mb-3">Location Data (Background Location)</h2>
        <p className="text-white font-semibold mb-3">
          Field Manager Pro collects your precise GPS location data to verify your clock-in location and track your work route during active shifts, even when the app is closed or not in use (background location).
        </p>
        <p className="mb-3 text-sm">Specifically:</p>
        <ul className="list-disc list-inside space-y-2 text-sm mb-4">
          <li>Location collection begins when you clock in for a shift.</li>
          <li>Location is collected continuously at regular intervals while your shift is active, <strong className="text-white">including when the app is running in the background, minimized, or the screen is off.</strong></li>
          <li>Location collection stops immediately and automatically when you clock out.</li>
          <li>Location data is used solely for employment-related purposes: verifying attendance, logging field activity, and providing your employer with operational visibility.</li>
          <li>Location data is accessible only to authorized managers and operations staff within your organization.</li>
          <li>We do not sell, rent, or share location data with any third parties outside of your organization.</li>
        </ul>
        <p className="text-sm">
          Before your first clock-in, you will be shown a clear disclosure explaining this background location use and asked to grant the necessary device permissions. You may revoke location permission in your device settings at any time, but doing so will prevent you from using the clock-in feature.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>To record and manage employee work shifts and time records</li>
          <li>To provide managers with real-time and historical visibility into field team activity</li>
          <li>To generate reports for payroll and operations purposes</li>
          <li>To send work-related push notifications (schedule updates, task assignments, etc.)</li>
          <li>To improve the reliability and performance of the App</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Data Sharing</h2>
        <p>We do not sell your personal information. Your data is shared only within your organization (between employees, managers, and administrators) as necessary to operate the service. We use third-party infrastructure providers (hosting, database, cloud storage) who process data on our behalf under confidentiality obligations and do not have independent access to your personal data.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Data Retention</h2>
        <p>Data is retained for as long as your account is active or as required by your organization. You may contact your organization&apos;s administrator to request data deletion. Shift and location records may be retained for payroll and compliance purposes for the period required by applicable law.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Security</h2>
        <p>All data is transmitted over encrypted HTTPS connections. Access to data is restricted by role-based permissions within your organization. Location data is stored in a secured database accessible only to authorized personnel.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Children&apos;s Privacy</h2>
        <p>The App is intended for use by employees aged 18 and older. We do not knowingly collect information from minors.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will notify users of material changes through the App or by email. Continued use of the App after changes constitutes acceptance of the updated policy.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
        <p>If you have questions about this Privacy Policy or how your data is handled, please contact us at <a href="mailto:support@fieldmanagerpro.app" className="text-violet-400 underline">support@fieldmanagerpro.app</a>.</p>
      </section>
    </div>
  )
}
