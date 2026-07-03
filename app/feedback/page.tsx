"use client";

import { FeedbackForm } from "@/components/FeedbackForm";
import { useStrings } from "@/components/SettingsProvider";
import { useEffect, useState } from "react";

export default function FeedbackPage() {
  const t = useStrings();
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 py-16 px-4">
      <div className="mx-auto max-w-xl">
        <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {t("feedback.page_title")}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {t("feedback.page_description")}
          </p>
          <FeedbackForm initialPageUrl={pageUrl} />
        </div>
      </div>
    </main>
  );
}
