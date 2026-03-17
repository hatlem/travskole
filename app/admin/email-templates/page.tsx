'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  _count: { triggers: number };
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('nb-NO');
}

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await fetch('/api/admin/email-templates');
        if (!res.ok) throw new Error('Kunne ikke hente e-postmaler');
        const data = await res.json();
        setTemplates(data.templates);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ukjent feil');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-[#003B7A] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
        <p className="text-red-700 font-medium mb-2">Feil ved lasting av e-postmaler</p>
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">E-postmaler</h1>
        <Link
          href="/admin/email-templates/new"
          className="bg-[#003B7A] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors"
        >
          + Opprett ny mal
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Ingen e-postmaler enna</h3>
          <p className="text-gray-500 mb-6">Kom i gang ved a opprette din forste mal.</p>
          <Link
            href="/admin/email-templates/new"
            className="inline-flex items-center bg-[#003B7A] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors"
          >
            + Opprett din forste mal
          </Link>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
              >
                <h3 className="font-semibold text-gray-900 mb-1">{template.name}</h3>
                <p className="text-sm text-gray-500 mb-3 truncate">{template.subject}</p>
                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-gray-500">Brukt i:</span>{' '}
                    <span className="text-gray-900">
                      {template._count.triggers} {template._count.triggers === 1 ? 'trigger' : 'triggere'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Opprettet:</span>{' '}
                    <span className="text-gray-900">{formatDate(template.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                  <Link
                    href={`/admin/email-templates/${template.id}`}
                    className="text-[#003B7A] hover:underline font-medium text-sm"
                  >
                    Rediger
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3 text-left">Navn</th>
                    <th className="px-6 py-3 text-left">Emne</th>
                    <th className="px-6 py-3 text-left">Brukt i</th>
                    <th className="px-6 py-3 text-left">Opprettet</th>
                    <th className="px-6 py-3 text-left">Handlinger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {templates.map((template) => (
                    <tr key={template.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {template.name}
                      </td>
                      <td className="px-6 py-4 text-gray-600 max-w-xs truncate">
                        {template.subject}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {template._count.triggers} {template._count.triggers === 1 ? 'trigger' : 'triggere'}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatDate(template.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/email-templates/${template.id}`}
                          className="text-[#003B7A] hover:underline font-medium text-xs"
                        >
                          Rediger
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
