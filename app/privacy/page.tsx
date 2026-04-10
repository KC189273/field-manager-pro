export const metadata = {
  title: 'Privacy Policy – Field Manager Pro',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300 px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: April 10, 2025</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Overview</h2>
        <p>Field Manager Pro (&quot;the App&quot;) is a field team management application. This Privacy Policy explains how we collect, use, and protect information when you use our service.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Information We Collect</h2>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Account information:</strong> Name and credentials provided by your employer when your account is created.</li>
          <li><strong>Location data:</strong> GPS coordinates collected while you are clocked in to record your work route. Location tracking stops when you clock out.</li>
          <li><strong>Clock records:</strong> Clock-in and clock-out times and locations.</li>
          <li><strong>Form submissions:</strong> Data entered into visit reports, checklists, and expense forms as part of your job duties.</li>
          <li><strong>Photos:</strong> Images uploaded as part of visit reports or expense submissions.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>To record and manage employee work shifts and time records</li>
          <li>To provide managers with visibility into field team activity</li>
          <li>To generate reports for payroll and operations purposes</li>
          <li>To improve the reliability and performance of the App</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Location Data</h2>
        <p>Location data is only collected while an employee is actively clocked in. This data is visible to authorized managers and operations staff within your organization. Location tracking ceases immediately upon clocking out. We do not sell or share location data with third parties.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Data Sharing</h2>
        <p>We do not sell your personal information. Data is shared only within your organization (between employees, managers, and administrators) as necessary to operate the service. We use third-party infrastructure providers (hosting, database, storage) who process data on our behalf under confidentiality obligations.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Data Retention</h2>
        <p>Data is retained for as long as your account is active or as required by your organization. You may contact your organization&apos;s administrator to request data deletion.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Security</h2>
        <p>All data is transmitted over encrypted HTTPS connections. Access to data is restricted by role-based permissions within your organization.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Children&apos;s Privacy</h2>
        <p>The App is intended for use by employees aged 18 and older. We do not knowingly collect information from minors.</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Contact</h2>
        <p>If you have questions about this Privacy Policy, please contact us at <a href="mailto:support@fieldmanagerpro.app" className="text-violet-400 underline">support@fieldmanagerpro.app</a>.</p>
      </section>
    </div>
  )
}
