'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewCoursePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      type: formData.get('type') as string,
      startDate: formData.get('startDate') as string,
      endDate: (formData.get('endDate') as string) || null,
      ageMin: formData.get('ageMin') ? Number(formData.get('ageMin')) : null,
      ageMax: formData.get('ageMax') ? Number(formData.get('ageMax')) : null,
      price: formData.get('price') ? Number(formData.get('price')) : null,
      maxParticipants: formData.get('maxParticipants') ? Number(formData.get('maxParticipants')) : null,
      status: formData.get('status') as string,
    };

    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Kunne ikke opprette kurs');
      }

      router.push('/admin/courses');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <Link href="/admin/courses" className="text-sm text-[#003B7A] hover:underline font-medium">
          &larr; Tilbake til kurs
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Nytt kurs</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Kursnavn *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Beskrivelse
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
              Type *
            </label>
            <select
              id="type"
              name="type"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            >
              <option value="kurs">Kurs</option>
              <option value="leir">Leir</option>
            </select>
          </div>

          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status *
            </label>
            <select
              id="status"
              name="status"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            >
              <option value="open">Apen</option>
              <option value="full">Fullt</option>
              <option value="closed">Stengt</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
              Startdato *
            </label>
            <input
              type="date"
              id="startDate"
              name="startDate"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
              Sluttdato
            </label>
            <input
              type="date"
              id="endDate"
              name="endDate"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ageMin" className="block text-sm font-medium text-gray-700 mb-1">
              Minimumsalder
            </label>
            <input
              type="number"
              id="ageMin"
              name="ageMin"
              min={0}
              max={18}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="ageMax" className="block text-sm font-medium text-gray-700 mb-1">
              Maksimumsalder
            </label>
            <input
              type="number"
              id="ageMax"
              name="ageMax"
              min={0}
              max={18}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Pris (kr)
            </label>
            <input
              type="number"
              id="price"
              name="price"
              min={0}
              step={1}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="maxParticipants" className="block text-sm font-medium text-gray-700 mb-1">
              Maks deltakere
            </label>
            <input
              type="number"
              id="maxParticipants"
              name="maxParticipants"
              min={1}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
          <button
            type="submit"
            disabled={loading}
            className="bg-[#003B7A] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors disabled:opacity-50"
          >
            {loading ? 'Oppretter...' : 'Opprett kurs'}
          </button>
          <Link
            href="/admin/courses"
            className="text-gray-600 hover:text-gray-800 px-4 py-2.5 text-sm font-medium"
          >
            Avbryt
          </Link>
        </div>
      </form>
    </div>
  );
}
