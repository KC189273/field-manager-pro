export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950">
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-3">
        <span className="text-amber-400 font-bold text-sm tracking-wide">FMP SUPER ADMIN</span>
      </div>
      {children}
    </div>
  )
}
