export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-2 pb-20 space-y-2 max-w-lg mx-auto">
        {/* Skeleton cards */}
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
            <div className="h-3 bg-gray-800 rounded w-24 mb-3" />
            <div className="h-6 bg-gray-800 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-800 rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
