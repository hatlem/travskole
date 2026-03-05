'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';

interface ImageUploadProps {
  currentUrl?: string | null;
  onUpload: (url: string) => void;
}

export default function ImageUpload({ currentUrl, onUpload }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Opplasting feilet');
      }

      const { url } = await res.json();
      setPreview(url);
      onUpload(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Kursbilde
      </label>

      {preview && (
        <div className="relative w-full h-48 mb-3 rounded-lg overflow-hidden border border-gray-200">
          <Image
            src={preview}
            alt="Kursbilde"
            fill
            className="object-cover"
          />
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              onUpload('');
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="absolute top-2 right-2 bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-red-700"
          >
            &times;
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        disabled={uploading}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#003B7A] file:text-white hover:file:bg-[#002855] file:cursor-pointer disabled:opacity-50"
      />
      <p className="text-xs text-gray-500 mt-1">JPG, PNG eller WebP. Maks 5 MB.</p>

      {uploading && <p className="text-sm text-blue-600 mt-2">Laster opp...</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
