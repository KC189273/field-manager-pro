export default function MapLoading() {
  return (
    <div className="min-h-screen bg-gray-950 pt-14 flex flex-col">
      <div className="h-14 fixed top-0 left-0 right-0 z-40 bg-gray-950 border-b border-gray-800" />
      <div className="flex-1 bg-gray-900 animate-pulse mx-0" />
      <div className="px-4 py-3 border-t border-gray-800 flex gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 bg-gray-800 rounded-xl flex-1 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
