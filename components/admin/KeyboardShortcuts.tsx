'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const SHORTCUTS: { keys: string; label: string; path: string }[] = [
  { keys: 'g d', label: 'Dashboard', path: '/admin' },
  { keys: 'g c', label: 'Kurs', path: '/admin/courses' },
  { keys: 'g r', label: 'Påmeldinger', path: '/admin/registrations' },
  { keys: 'g u', label: 'Brukere', path: '/admin/users' },
  { keys: 'g b', label: 'Dobbeltsulky', path: '/admin/dobbeltsulky' },
  { keys: 'g a', label: 'Aktivitetslogg', path: '/admin/activity' },
];

const COMBO_TIMEOUT = 500;

export const KeyboardShortcuts = () => {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const lastKeyRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const isInputFocused = useCallback(() => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      (el as HTMLElement).isContentEditable
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      if (e.key === 'Escape') {
        setShowModal(false);
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowModal((prev) => !prev);
        return;
      }

      const key = e.key.toLowerCase();

      if (lastKeyRef.current === 'g') {
        const match = SHORTCUTS.find((s) => s.keys === `g ${key}`);
        if (match) {
          e.preventDefault();
          setShowModal(false);
          router.push(match.path);
        }
        lastKeyRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        return;
      }

      lastKeyRef.current = key;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastKeyRef.current = null;
        timerRef.current = null;
      }, COMBO_TIMEOUT);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [router, isInputFocused]);

  if (!showModal) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
      }}
      onClick={() => setShowModal(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          padding: '24px 28px',
          maxWidth: 420,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#111827' }}>
            Tastatursnarveier
          </h2>
          <button
            onClick={() => setShowModal(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: '#6b7280',
              lineHeight: 1,
            }}
            aria-label="Lukk"
          >
            &times;
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
              }}
            >
              <span style={{ color: '#374151', fontSize: 14 }}>{s.label}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {s.keys.split(' ').map((k, i) => (
                  <kbd
                    key={i}
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      color: '#374151',
                      backgroundColor: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      boxShadow: '0 1px 0 #d1d5db',
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}

          <div
            style={{
              borderTop: '1px solid #e5e7eb',
              paddingTop: 10,
              marginTop: 4,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#374151', fontSize: 14 }}>Vis/skjul snarveier</span>
            <kbd
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 600,
                color: '#374151',
                backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                boxShadow: '0 1px 0 #d1d5db',
              }}
            >
              ?
            </kbd>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#374151', fontSize: 14 }}>Lukk modal</span>
            <kbd
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 600,
                color: '#374151',
                backgroundColor: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                boxShadow: '0 1px 0 #d1d5db',
              }}
            >
              Esc
            </kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
