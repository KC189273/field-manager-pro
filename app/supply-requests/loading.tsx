export default function SupplyRequestsLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto space-y-3">
        <div className="flex items-center justify-between mb-2">
          <div className="h-7 bg-gray-800 rounded w-36 animate-pulse" />
          <div className="h-9 bg-gray-800 rounded-xl w-28 animate-pulse" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 bg-gray-800 rounded w-40" />
              <div className="h-5 bg-gray-800 rounded-full w-20" />
            </div>
            <div className="h-3 bg-gray-800 rounded w-56 mb-2" />
            <div className="h-3 bg-gray-800 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
