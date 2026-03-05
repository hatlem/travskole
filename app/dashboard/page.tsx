'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

// Force dynamic rendering for search params
export const dynamic = 'force-dynamic';

function DashboardContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success');

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4">
        {success === 'registration' && (
          <div className="bg-green-50 border-l-4 border-green-500 p-6 mb-8">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-semibold text-green-800">
                  Påmelding vellykket!
                </h3>
                <p className="mt-2 text-green-700">
                  Takk for påmeldingen! Du vil motta en bekreftelse på e-post snart.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Dashboard</h1>
          
          <p className="text-gray-600 mb-8">
            Velkommen til ditt dashboard. Her vil du snart kunne se dine påmeldinger og administrere din profil.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <Link 
              href="/courses"
              className="block bg-[#003B7A] text-white rounded-lg p-6 hover:bg-[#002855] transition"
            >
              <h3 className="text-xl font-semibold mb-2">Se alle kurs</h3>
              <p className="text-blue-100">Utforsk våre kurs og leirer</p>
            </Link>

            <div className="block bg-gray-100 text-gray-700 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">Mine påmeldinger</h3>
              <p className="text-gray-600">Kommer snart...</p>
            </div>

            <div className="block bg-gray-100 text-gray-700 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">Mine barn</h3>
              <p className="text-gray-600">Kommer snart...</p>
            </div>

            <div className="block bg-gray-100 text-gray-700 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">Profil</h3>
              <p className="text-gray-600">Kommer snart...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 py-16"><div className="max-w-4xl mx-auto px-4">Loading...</div></div>}>
      <DashboardContent />
    </Suspense>
  );
}
