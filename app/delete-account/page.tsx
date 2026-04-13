export const metadata = {
  title: 'Delete Account – Field Manager Pro',
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300 px-6 py-12 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Delete Your Account</h1>
      <p className="text-sm text-gray-500 mb-8">Field Manager Pro</p>

      <section className="mb-8">
        <p className="text-gray-300 mb-4">
          To request deletion of your account and associated data, please contact your organization&apos;s administrator or reach out to us directly.
        </p>
        <p className="text-gray-300 mb-4">
          Upon receiving your request, we will delete your account and remove the following data:
        </p>
        <ul className="list-disc list-inside space-y-2 text-gray-400 mb-4">
          <li>Your name and login credentials</li>
          <li>Clock-in and clock-out records</li>
          <li>GPS location history</li>
          <li>Expense submissions and receipts</li>
          <li>Visit reports and checklist submissions</li>
        </ul>
        <p className="text-gray-300">
          Please allow up to 30 days for your data to be fully removed from our systems.
        </p>
      </section>

      <section className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Contact Us</h2>
        <p className="text-gray-400 text-sm mb-2">Send your account deletion request to:</p>
        <a
          href="mailto:support@fieldmanagerpro.app"
          className="text-violet-400 hover:text-violet-300 underline text-sm"
        >
          support@fieldmanagerpro.app
        </a>
        <p className="text-gray-500 text-xs mt-4">
          Please include your full name and the email address associated with your account.
        </p>
      </section>
    </div>
  )
}
