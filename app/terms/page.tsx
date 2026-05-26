import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-950 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/login" className="text-violet-400 hover:text-violet-300 text-sm transition-colors">
            ← Back to sign in
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-gray-500 text-sm mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-gray-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-white font-semibold text-base mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using Field Manager Pro ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, including organization administrators, managers, and employees.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">2. Description of Service</h2>
            <p>Field Manager Pro is a field team management platform providing time tracking, GPS location recording, scheduling, expense management, payroll reporting, and related tools for businesses with field-based workforces. Access is granted by invitation only through your organization administrator.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">3. User Accounts</h2>
            <p className="mb-2">Accounts are provisioned by your organization. You are responsible for maintaining the confidentiality of your credentials. You agree to:</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Provide accurate information when required</li>
              <li>Not share your account credentials with others</li>
              <li>Notify your administrator immediately of any unauthorized access</li>
              <li>Use the Service only for its intended business purposes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">4. GPS and Location Data</h2>
            <p>By using the clock-in/out and tracking features, you consent to the collection and storage of your GPS location data during active shifts. Location data is used solely for workforce management purposes and is accessible only to authorized personnel within your organization. You may disable location permissions on your device, though this may limit certain functionality.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">5. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Service</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Submit false or misleading time, location, or expense data</li>
              <li>Reverse engineer or attempt to extract the source code of the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">6. Data and Privacy</h2>
            <p>Your use of the Service is also governed by our <Link href="/privacy" className="text-violet-400 hover:text-violet-300">Privacy Policy</Link>. We collect and process data as described therein. Organization administrators control data access within their organization. Employee data is retained for the duration of the organization's subscription and for a reasonable period thereafter as required by law.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">7. Intellectual Property</h2>
            <p>The Service, including all software, design, and content, is the exclusive property of Field Manager Pro. Nothing in these terms grants you ownership rights to the Service. Your organization's data remains your organization's property.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">8. Availability and Modifications</h2>
            <p>We strive to maintain high availability but do not guarantee uninterrupted access. We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice. We may update these terms periodically; continued use constitutes acceptance of updated terms.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">9. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Field Manager Pro shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service, including but not limited to loss of data, lost profits, or business interruption. Our total liability shall not exceed the amount paid by your organization in the three months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">10. Termination</h2>
            <p>We may terminate or suspend access to the Service immediately, without notice, for conduct that we believe violates these terms or is harmful to other users, the Service, or third parties. Upon termination, your right to use the Service ceases immediately.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">11. Governing Law</h2>
            <p>These terms are governed by the laws of the State of Texas, without regard to conflict of law provisions. Any disputes shall be resolved in the courts of Texas.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-base mb-2">12. Contact</h2>
            <p>Questions about these terms? Contact us at <span className="text-violet-400">support@fieldmanagerpro.app</span></p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 flex gap-6 text-xs text-gray-600">
          <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy Policy</Link>
          <Link href="/login" className="hover:text-gray-400 transition-colors">Sign In</Link>
        </div>
      </div>
    </div>
  )
}
