export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="h-10 w-64 bg-white/20 rounded animate-pulse mb-3" />
          <div className="h-5 w-96 bg-white/10 rounded animate-pulse" />
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-3" />
              <div className="h-4 w-full bg-gray-100 rounded animate-pulse mb-2" />
              <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
