export default function CalendarLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-3 sm:px-6 pt-4 pb-24 max-w-4xl mx-auto space-y-4">
        {/* Tab bar skeleton */}
        <div className="flex bg-gray-900 rounded-2xl p-1 gap-1">
          <div className="flex-1 h-9 bg-gray-800 rounded-xl animate-pulse" />
          <div className="flex-1 h-9 bg-gray-800 rounded-xl animate-pulse" />
        </div>
        {/* Month nav */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gray-800 rounded-xl animate-pulse" />
            <div className="h-6 bg-gray-800 rounded w-36 animate-pulse" />
            <div className="w-9 h-9 bg-gray-800 rounded-xl animate-pulse" />
          </div>
          <div className="h-9 bg-gray-800 rounded-xl w-28 animate-pulse" />
        </div>
        {/* Grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-2xl overflow-hidden border border-gray-800">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="min-h-[68px] bg-gray-900 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
