'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Noe gikk galt</h1>
        <p className="text-gray-600 mb-8">
          En uventet feil oppstod. Prøv igjen eller gå tilbake til forsiden.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="bg-[#003B7A] hover:bg-[#002855] text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            Prøv igjen
          </button>
          <a
            href="/"
            className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-6 py-3 rounded-lg font-semibold transition"
          >
            Til forsiden
          </a>
        </div>
      </div>
    </div>
  );
}
