export default function ClockLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-20 max-w-lg mx-auto space-y-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-32 mb-4" />
          <div className="h-14 bg-gray-800 rounded-xl w-full mb-3" />
          <div className="h-4 bg-gray-800 rounded w-48" />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-40 mb-3" />
          <div className="h-8 bg-gray-800 rounded w-24" />
        </div>
      </div>
    </div>
  )
}
