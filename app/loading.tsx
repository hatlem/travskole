export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-bjerke-blue border-t-transparent" />
        <p className="text-gray-500 text-sm">Laster...</p>
      </div>
    </div>
  );
}
