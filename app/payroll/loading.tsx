export default function PayrollLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto space-y-3">
        <div className="h-7 bg-gray-800 rounded w-24 animate-pulse" />
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-32 mb-3" />
          <div className="flex gap-2">
            <div className="h-10 bg-gray-800 rounded-xl flex-1" />
            <div className="h-10 bg-gray-800 rounded-xl flex-1" />
            <div className="h-10 bg-gray-800 rounded-xl w-24" />
          </div>
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="h-4 bg-gray-800 rounded w-36" />
              <div className="h-4 bg-gray-800 rounded w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
