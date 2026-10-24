'use client';

import Link from 'next/link';
import { useSettings } from '@/components/SettingsProvider';

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

interface CourseTextFieldsProps {
  audience: string;
  learningPoints: string;
  packingList: string;
  onLearningPointsChange: (value: string) => void;
  onPackingListChange: (value: string) => void;
}

/** «Hva du lærer» og pakkelisten for ett kurs. Tomt felt = standardteksten fra Innstillinger. */
export function CourseTextFields({
  audience,
  learningPoints,
  packingList,
  onLearningPointsChange,
  onPackingListChange,
}: CourseTextFieldsProps) {
  const settings = useSettings();
  const isAdult = audience === 'voksen';
  const defaultLearning = (isAdult ? settings.course_learning_points_adult : settings.course_learning_points) ?? '';
  const defaultPacking = (isAdult ? settings.course_packing_list_adult : settings.course_packing_list) ?? '';

  const fields = [
    { id: 'learningPoints', label: 'Hva du lærer', value: learningPoints, onChange: onLearningPointsChange, fallback: defaultLearning },
    { id: 'packingList', label: 'Praktisk informasjon – hva du skal ha med', value: packingList, onChange: onPackingListChange, fallback: defaultPacking },
  ];

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f.id}>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={f.id} className={labelClass}>
              {f.label}
            </label>
            {!f.value && f.fallback && (
              <button
                type="button"
                onClick={() => f.onChange(f.fallback)}
                className="text-xs text-bjerke-blue underline underline-offset-2 hover:text-bjerke-blue-dark"
              >
                Rediger standardteksten for dette kurset
              </button>
            )}
          </div>
          <textarea
            id={f.id}
            name={f.id}
            rows={4}
            maxLength={2000}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            placeholder={f.fallback}
            className={inputClass}
          />
        </div>
      ))}
      <p className="text-xs text-gray-500">
        Ett punkt per linje. La feltet stå tomt for å bruke standardteksten fra{' '}
        <Link href="/admin/settings" className="text-bjerke-blue underline underline-offset-2">
          Innstillinger → Kurssidene
        </Link>
        .
      </p>
    </div>
  );
}
