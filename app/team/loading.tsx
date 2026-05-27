export default function TeamLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-20 max-w-lg mx-auto space-y-2">
        <div className="h-10 bg-gray-900 border border-gray-800 rounded-xl animate-pulse mb-3" />
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-full shrink-0" />
            <div className="flex-1">
              <div className="h-4 bg-gray-800 rounded w-36 mb-2" />
              <div className="h-3 bg-gray-800 rounded w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
