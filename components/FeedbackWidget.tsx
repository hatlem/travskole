"use client";

import { useState, useRef, useCallback } from "react";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setPageUrl(window.location.href);
    setOpen(isOpen);
  };

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      showToast("Velg en bildefil", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Bildet må være under 5MB", "error");
      return;
    }
    setImage(file);
    setShowDetails(true);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const removeImage = () => {
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!feedback.trim()) {
      showToast("Skriv en tilbakemelding", "error");
      return;
    }
    setLoading(true);
    try {
      let screenshots: string[] = [];

      if (image) {
        const formData = new FormData();
        formData.append("file", image);
        const uploadRes = await fetch("/api/feedback/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const uploadData = await uploadRes.json();
        screenshots = [uploadData.url];
      }

      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: feedback, screenshots, pageUrl: pageUrl.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("Takk for tilbakemeldingen!", "success");
      setFeedback("");
      removeImage();
      setOpen(false);
    } catch {
      showToast("Kunne ikke sende tilbakemelding", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-16 right-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-all ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => handleOpen(true)}
        title="Gi tilbakemelding"
        className="fixed bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-colors hover:bg-gray-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      </button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => handleOpen(false)} />
          <div
            className={`relative mx-4 w-full max-w-[425px] rounded-xl bg-white p-6 shadow-xl transition-colors ${
              dragging ? "ring-2 ring-[var(--bjerke-blue)] ring-offset-2" : ""
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Close button */}
            <button
              onClick={() => handleOpen(false)}
              className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>

            <h2 className="sr-only">Gi tilbakemelding</h2>

            {/* Drop overlay */}
            {dragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
                    <line x1="16" x2="22" y1="5" y2="5" />
                    <line x1="19" x2="19" y1="2" y2="8" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <span className="text-sm font-medium">Slipp bildet her</span>
                </div>
              </div>
            )}

            {/* Textarea */}
            <textarea
              placeholder="Hva kan vi gjøre bedre?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-32 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm outline-none transition-colors focus:border-[var(--bjerke-blue)] focus:ring-1 focus:ring-[var(--bjerke-blue)]"
              disabled={loading}
              autoFocus
            />

            {/* Details toggle */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${showDetails ? "rotate-0" : "-rotate-90"}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
                Legg til detaljer
              </button>

              {showDetails && (
                <div className="mt-2 space-y-3">
                  {/* Page URL */}
                  <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      <path d="M2 12h20" />
                    </svg>
                    <input
                      type="text"
                      value={pageUrl}
                      onChange={(e) => setPageUrl(e.target.value)}
                      className="w-full bg-transparent text-xs text-gray-500 outline-none"
                      disabled={loading}
                    />
                  </div>

                  {/* Image upload */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    {imagePreview ? (
                      <div className="relative inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreview}
                          alt="Vedlagt skjermbilde"
                          className="h-20 rounded border object-cover"
                        />
                        <button
                          type="button"
                          onClick={removeImage}
                          className="absolute -right-2 -top-2 rounded-full bg-red-500 p-0.5 text-white shadow-sm"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
                          <line x1="16" x2="22" y1="5" y2="5" />
                          <line x1="19" x2="19" y1="2" y2="8" />
                          <circle cx="9" cy="9" r="2" />
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                        Legg til bilde
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={loading || !feedback.trim()}
                className="rounded-lg bg-[var(--bjerke-blue)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--bjerke-blue-dark)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Sender..." : "Send tilbakemelding"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
