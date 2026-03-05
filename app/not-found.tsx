import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-[#003B7A] mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Siden ble ikke funnet</h2>
        <p className="text-gray-600 mb-8">
          Beklager, vi finner ikke siden du leter etter.
        </p>
        <Link
          href="/"
          className="inline-block bg-[#003B7A] hover:bg-[#002855] text-white px-6 py-3 rounded-lg font-semibold transition"
        >
          Til forsiden
        </Link>
      </div>
    </div>
  );
}
