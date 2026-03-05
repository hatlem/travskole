'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface CourseData {
  id: number;
  name: string;
  description: string | null;
  type: string;
  startDate: string;
  endDate: string | null;
  ageMin: number | null;
  ageMax: number | null;
  price: number | null;
  maxParticipants: number | null;
  status: string;
}

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCourse() {
      try {
        const res = await fetch(`/api/admin/courses/${id}`);
        if (!res.ok) throw new Error('Kunne ikke hente kurs');
        const data = await res.json();
        setCourse(data.course);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Noe gikk galt');
      } finally {
        setLoading(false);
      }
    }
    fetchCourse();
  }, [id]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
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
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Kunne ikke oppdatere kurs');
      }

      router.push('/admin/courses');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Er du sikker pa at du vil slette dette kurset? Alle pameldinger vil ogsa bli slettet.')) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/courses/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Kunne ikke slette kurs');
      }
      router.push('/admin/courses');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Laster kurs...</p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">Kurset ble ikke funnet.</p>
        <Link href="/admin/courses" className="text-[#003B7A] hover:underline font-medium">
          Tilbake til kurs
        </Link>
      </div>
    );
  }

  const startDateFormatted = course.startDate ? new Date(course.startDate).toISOString().split('T')[0] : '';
  const endDateFormatted = course.endDate ? new Date(course.endDate).toISOString().split('T')[0] : '';

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <Link href="/admin/courses" className="text-sm text-[#003B7A] hover:underline font-medium">
          &larr; Tilbake til kurs
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Rediger kurs</h1>
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
            defaultValue={course.name}
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
            defaultValue={course.description || ''}
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
              defaultValue={course.type}
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
              defaultValue={course.status}
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
              defaultValue={startDateFormatted}
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
              defaultValue={endDateFormatted}
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
              defaultValue={course.ageMin ?? ''}
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
              defaultValue={course.ageMax ?? ''}
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
              defaultValue={course.price ?? ''}
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
              defaultValue={course.maxParticipants ?? ''}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-[#003B7A] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors disabled:opacity-50"
            >
              {saving ? 'Lagrer...' : 'Lagre endringer'}
            </button>
            <Link
              href="/admin/courses"
              className="text-gray-600 hover:text-gray-800 px-4 py-2.5 text-sm font-medium"
            >
              Avbryt
            </Link>
          </div>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 hover:text-red-800 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {deleting ? 'Sletter...' : 'Slett kurs'}
          </button>
        </div>
      </form>
    </div>
  );
}
