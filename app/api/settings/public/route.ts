import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/settings';

// Public settings endpoint — only exposes non-sensitive settings
const PUBLIC_KEYS = [
  'site_name',
  'contact_email',
  'contact_address',
  'contact_phone',
  'instructor_name',
  'instructor_certification',
  'dobbeltsulky_enabled',
  'dobbeltsulky_description',
  'consent_activities_text',
  'consent_media_text',
  'consent_risk_text',
  'consent_risk_detail',
];

export async function GET() {
  const all = await getSettings();
  const publicSettings: Record<string, string> = {};
  for (const key of PUBLIC_KEYS) {
    if (all[key] !== undefined) {
      publicSettings[key] = all[key];
    }
  }
  return NextResponse.json({ settings: publicSettings });
}
