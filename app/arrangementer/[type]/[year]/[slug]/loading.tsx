export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <div className="h-4 w-32 bg-white/20 rounded animate-pulse mb-4" />
          <div className="h-12 w-80 bg-white/20 rounded animate-pulse mb-3" />
          <div className="h-8 w-16 bg-blue-600 rounded-full animate-pulse" />
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="h-8 w-40 bg-gray-200 rounded animate-pulse mb-4" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          </div>
          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="h-10 w-24 bg-gray-200 rounded animate-pulse mb-4" />
              <div className="space-y-3">
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-14 w-full bg-gray-200 rounded-lg animate-pulse mt-6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
