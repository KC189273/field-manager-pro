export default function TimecardsLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-20 max-w-lg mx-auto space-y-3">
        <div className="flex gap-2 animate-pulse">
          <div className="h-9 bg-gray-900 border border-gray-800 rounded-xl flex-1" />
          <div className="h-9 bg-gray-900 border border-gray-800 rounded-xl w-24" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
            <div className="h-10 bg-gray-800/50 border-b border-gray-800 px-4 flex items-center">
              <div className="h-4 bg-gray-700 rounded w-32" />
            </div>
            <div className="p-4 space-y-2">
              <div className="h-3 bg-gray-800 rounded w-48" />
              <div className="h-3 bg-gray-800 rounded w-36" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
