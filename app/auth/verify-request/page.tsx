import Link from 'next/link';

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-gray-200 rounded-lg text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Sjekk e-posten din
          </h2>
          <p className="text-gray-600 mb-6">
            Vi har sendt deg en innloggingslenke. Klikk på lenken i e-posten for å logge inn.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Finner du ikke e-posten? Sjekk søppelpost-mappen.
          </p>
          <Link
            href="/auth/login"
            className="text-[#003B7A] hover:underline font-medium"
          >
            Tilbake til innlogging
          </Link>
        </div>
      </div>
    </div>
  );
}
