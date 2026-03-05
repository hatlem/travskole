'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Registration {
  id: number;
  status: string;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
  createdAt: string;
  course: { id: number; name: string };
  child: { id: number; name: string };
  parent: { id: number; name: string; phone: string; user: { email: string } };
}

export default function AdminRegistrationsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    fetchRegistrations();
  }, []);

  async function fetchRegistrations() {
    try {
      const res = await fetch('/api/admin/registrations');
      if (!res.ok) throw new Error('Kunne ikke hente pameldinger');
      const data = await res.json();
      setRegistrations(data.registrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/registrations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere status');
      setRegistrations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteRegistration(id: number) {
    if (!confirm('Er du sikker pa at du vil slette denne pameldingen?')) return;

    try {
      const res = await fetch(`/api/admin/registrations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Kunne ikke slette pamelding');
      setRegistrations((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Laster pameldinger...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Pameldinger</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Lukk
          </button>
        </div>
      )}

      {registrations.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Ingen pameldinger enna.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-6 py-3 text-left">ID</th>
                  <th className="px-6 py-3 text-left">Kurs</th>
                  <th className="px-6 py-3 text-left">Barn</th>
                  <th className="px-6 py-3 text-left">Forelder</th>
                  <th className="px-6 py-3 text-left">E-post</th>
                  <th className="px-6 py-3 text-left">Telefon</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Dato</th>
                  <th className="px-6 py-3 text-left">Handlinger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {registrations.map((reg) => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-500">#{reg.id}</td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      <Link href={`/admin/courses/${reg.course.id}/edit`} className="hover:text-[#003B7A] hover:underline">
                        {reg.course.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-700">{reg.child.name}</td>
                    <td className="px-6 py-4 text-gray-700">{reg.parent.name}</td>
                    <td className="px-6 py-4 text-gray-500">{reg.parent.user?.email}</td>
                    <td className="px-6 py-4 text-gray-500">{reg.parent.phone}</td>
                    <td className="px-6 py-4">
                      <select
                        value={reg.status}
                        onChange={(e) => updateStatus(reg.id, e.target.value)}
                        disabled={updatingId === reg.id}
                        className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 focus:ring-2 focus:ring-[#003B7A] ${
                          reg.status === 'confirmed'
                            ? 'bg-green-100 text-green-800'
                            : reg.status === 'cancelled'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                        } ${updatingId === reg.id ? 'opacity-50' : ''}`}
                      >
                        <option value="pending">Venter</option>
                        <option value="confirmed">Bekreftet</option>
                        <option value="cancelled">Avlyst</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => deleteRegistration(reg.id)}
                        className="text-red-600 hover:text-red-800 text-xs font-medium"
                      >
                        Slett
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
