import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <h1 className="text-6xl font-bold text-[#003B7A] mb-4">404</h1>
      <p className="text-xl text-gray-600 mb-8">Siden ble ikke funnet</p>
      <Link
        href="/"
        className="bg-[#003B7A] text-white px-6 py-3 rounded-md font-semibold uppercase tracking-wide hover:bg-[#002855] transition"
      >
        Tilbake til forsiden
      </Link>
    </div>
  );
}
