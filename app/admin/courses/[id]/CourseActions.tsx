'use client';

import { useState } from 'react';

interface Registration {
  id: number;
  status: string;
  createdAt: string;
  childName: string;
  childBirthdate: string | null;
  childAllergies: string | null;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  waitlist: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function CourseActions({
  courseId,
  courseName,
  registrations: initialRegistrations,
}: {
  courseId: number;
  courseName: string;
  registrations: Registration[];
}) {
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Email form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [recipientFilter, setRecipientFilter] = useState<'all' | 'confirmed' | 'pending' | 'waitlist'>('all');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  async function updateStatus(id: number, status: string) {
    setUpdatingId(id);
    setError(null);
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

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    setSendingEmail(true);
    setError(null);
    setEmailSuccess(null);
    try {
      const res = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          subject: emailSubject,
          message: emailMessage,
          recipientFilter,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Kunne ikke sende e-post');
      }
      const data = await res.json();
      setEmailSuccess(`E-post sendt til ${data.sentCount} mottaker(e).`);
      setEmailSubject('');
      setEmailMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke sende e-post');
    } finally {
      setSendingEmail(false);
    }
  }

  const recipientLabels: Record<string, string> = {
    all: 'Alle foreldre',
    confirmed: 'Bekreftede',
    pending: 'Ventende',
    waitlist: 'Venteliste',
  };

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 font-medium text-red-800 hover:underline text-sm">
            Lukk
          </button>
        </div>
      )}

      {/* Email success */}
      {emailSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <span>{emailSuccess}</span>
          <button onClick={() => setEmailSuccess(null)} className="ml-4 font-medium text-green-800 hover:underline text-sm">
            Lukk
          </button>
        </div>
      )}

      {/* Email form toggle */}
      <div className="mb-6">
        <button
          onClick={() => setShowEmailForm(!showEmailForm)}
          className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {showEmailForm ? 'Skjul e-postskjema' : 'Send e-post'}
        </button>
      </div>

      {/* Email form */}
      {showEmailForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Send e-post til foreldre — {courseName}
            </h2>
          </div>
          <form onSubmit={handleSendEmail} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mottakere</label>
              <div className="flex flex-wrap gap-4">
                {(['all', 'confirmed', 'pending', 'waitlist'] as const).map((filter) => (
                  <label key={filter} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="recipientFilter"
                      value={filter}
                      checked={recipientFilter === filter}
                      onChange={() => setRecipientFilter(filter)}
                      className="text-[#003B7A] focus:ring-[#003B7A]"
                    />
                    <span className="text-sm text-gray-700">{recipientLabels[filter]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Emne</label>
              <input
                type="text"
                required
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder={`Informasjon om ${courseName}`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#003B7A] focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Melding</label>
              <textarea
                required
                rows={6}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Skriv meldingen her..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#003B7A] focus:border-transparent outline-none resize-y"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={sendingEmail}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  sendingEmail
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-[#003B7A] hover:bg-[#002855] text-white'
                }`}
              >
                {sendingEmail ? 'Sender...' : 'Send e-post'}
              </button>
              <button
                type="button"
                onClick={() => setShowEmailForm(false)}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
              >
                Avbryt
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Registrations table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Påmeldinger ({registrations.length})
          </h2>
        </div>

        {registrations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-500">Ingen påmeldinger ennå.</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {registrations.map((reg) => (
                <div key={reg.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{reg.childName}</span>
                    <select
                      value={reg.status}
                      onChange={(e) => updateStatus(reg.id, e.target.value)}
                      disabled={updatingId === reg.id}
                      className={`text-xs font-semibold rounded-full px-3 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-[#003B7A] ${
                        STATUS_COLORS[reg.status] || 'bg-gray-100 text-gray-800'
                      } ${updatingId === reg.id ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      <option value="pending">Venter</option>
                      <option value="confirmed">Bekreftet</option>
                      <option value="waitlist">Venteliste</option>
                      <option value="cancelled">Avlyst</option>
                    </select>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>Forelder: {reg.parentName}</p>
                    <p>{reg.parentEmail} &middot; {reg.parentPhone}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3 text-left">Barn</th>
                    <th className="px-6 py-3 text-left">Forelder</th>
                    <th className="px-6 py-3 text-left">E-post</th>
                    <th className="px-6 py-3 text-left">Telefon</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Dato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {registrations.map((reg, idx) => (
                    <tr
                      key={reg.id}
                      className={`hover:bg-blue-50/50 transition-colors ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                      }`}
                    >
                      <td className="px-6 py-3.5 font-medium text-gray-900">
                        {reg.childName}
                        {reg.childAllergies && (
                          <span className="ml-2 text-xs text-orange-600" title={reg.childAllergies}>
                            (allergi)
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3.5 text-gray-700">{reg.parentName}</td>
                      <td className="px-6 py-3.5 text-gray-500 text-xs">{reg.parentEmail}</td>
                      <td className="px-6 py-3.5 text-gray-500 text-xs">{reg.parentPhone}</td>
                      <td className="px-6 py-3.5">
                        <select
                          value={reg.status}
                          onChange={(e) => updateStatus(reg.id, e.target.value)}
                          disabled={updatingId === reg.id}
                          className={`text-xs font-semibold rounded-full px-3 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-[#003B7A] ${
                            STATUS_COLORS[reg.status] || 'bg-gray-100 text-gray-800'
                          } ${updatingId === reg.id ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <option value="pending">Venter</option>
                          <option value="confirmed">Bekreftet</option>
                          <option value="waitlist">Venteliste</option>
                          <option value="cancelled">Avlyst</option>
                        </select>
                      </td>
                      <td className="px-6 py-3.5 text-gray-400 text-xs">
                        {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
