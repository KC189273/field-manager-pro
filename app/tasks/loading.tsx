export default function TasksLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto space-y-3">
        <div className="h-8 bg-gray-900 rounded-xl w-48 animate-pulse" />
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
            <div className="h-3 bg-gray-800 rounded w-20 mb-3" />
            <div className="h-5 bg-gray-800 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-800 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
