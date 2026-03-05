'use client';

import { useState, useEffect } from 'react';

interface Booking {
  id: number;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: string | null;
  message: string | null;
  status: string;
  createdAt: string;
}

export default function AdminDobbeltsulkyPage() {
  const [enabled, setEnabled] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    async function load() {
      const [settingsRes, bookingsRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/bookings'),
      ]);
      const settingsData = await settingsRes.json();
      const bookingsData = await bookingsRes.json();
      setEnabled(settingsData.settings?.dobbeltsulky_enabled === 'true');
      setBookings(bookingsData.bookings || []);
      setLoading(false);
    }
    load();
  }, []);

  async function toggleEnabled() {
    setToggling(true);
    const newValue = !enabled;
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'dobbeltsulky_enabled', value: String(newValue) }),
    });
    setEnabled(newValue);
    setToggling(false);
  }

  async function updateStatus(id: number, status: string) {
    await fetch(`/api/admin/bookings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBookings(bookings.map(b => b.id === id ? { ...b, status } : b));
  }

  if (loading) {
    return <div className="py-20 text-center text-gray-500">Laster...</div>;
  }

  const newBookings = bookings.filter(b => b.status === 'new');
  const otherBookings = bookings.filter(b => b.status !== 'new');

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dobbeltsulky</h1>
          <p className="text-gray-600 text-sm mt-1">Slå på/av booking og se forespørsler</p>
        </div>

        <button
          onClick={toggleEnabled}
          disabled={toggling}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
            enabled ? 'bg-green-500' : 'bg-gray-300'
          } ${toggling ? 'opacity-50' : ''}`}
        >
          <span
            className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className={`rounded-lg px-4 py-3 mb-8 text-sm font-medium ${
        enabled ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200'
      }`}>
        {enabled
          ? 'Dobbeltsulky-booking er synlig for besøkende på arrangementer-siden.'
          : 'Dobbeltsulky-booking er skjult. Besøkende kan ikke booke.'}
      </div>

      {/* New bookings */}
      {newBookings.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Nye forespørsler ({newBookings.length})
          </h2>
          <div className="space-y-4">
            {newBookings.map(booking => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onUpdateStatus={updateStatus}
              />
            ))}
          </div>
        </div>
      )}

      {/* Earlier bookings */}
      {otherBookings.length > 0 && (
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Tidligere</h2>
          <div className="space-y-4">
            {otherBookings.map(booking => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onUpdateStatus={updateStatus}
              />
            ))}
          </div>
        </div>
      )}

      {bookings.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Ingen forespørsler ennå.</p>
        </div>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  onUpdateStatus,
}: {
  booking: Booking;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  const statusLabels: Record<string, string> = {
    new: 'Ny',
    confirmed: 'Bekreftet',
    cancelled: 'Avvist',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{booking.name}</h3>
          <p className="text-sm text-gray-500">
            {new Date(booking.createdAt).toLocaleDateString('nb-NO', {
              day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
        </div>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[booking.status] || 'bg-gray-100 text-gray-800'}`}>
          {statusLabels[booking.status] || booking.status}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
        <div>
          <p className="text-gray-500">E-post</p>
          <a href={`mailto:${booking.email}`} className="text-[#003B7A] hover:underline">{booking.email}</a>
        </div>
        <div>
          <p className="text-gray-500">Telefon</p>
          <a href={`tel:${booking.phone}`} className="text-[#003B7A] hover:underline">{booking.phone}</a>
        </div>
        <div>
          <p className="text-gray-500">Deltakere</p>
          <p className="font-medium">{booking.participants}</p>
        </div>
        <div>
          <p className="text-gray-500">Ønsket dato</p>
          <p className="font-medium">
            {booking.preferredDate
              ? new Date(booking.preferredDate).toLocaleDateString('nb-NO')
              : 'Ikke spesifisert'}
          </p>
        </div>
      </div>

      {booking.message && (
        <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-3">{booking.message}</p>
      )}

      {booking.status === 'new' && (
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={() => onUpdateStatus(booking.id, 'confirmed')}
            className="text-sm font-medium text-green-700 hover:text-green-900 px-3 py-1.5 rounded-md hover:bg-green-50 transition"
          >
            Bekreft
          </button>
          <button
            onClick={() => onUpdateStatus(booking.id, 'cancelled')}
            className="text-sm font-medium text-red-600 hover:text-red-800 px-3 py-1.5 rounded-md hover:bg-red-50 transition"
          >
            Avvis
          </button>
        </div>
      )}
    </div>
  );
}
