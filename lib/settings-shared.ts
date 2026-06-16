/**
 * Client-safe settings helpers — no database imports.
 * Server-only functions (getSettings, getSetting) live in lib/settings.ts,
 * which re-exports everything here.
 */

export type SiteSettings = Record<string, string>;

/**
 * Split a newline-separated setting value into a list of non-empty lines.
 * Used for bullet-point settings (home_feature_points, dobbeltsulky_points, ...).
 */
export function settingToList(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface CourseType {
  value: string;
  label: string;
  plural: string;
}

/**
 * Parse the course_types setting — one type per line, format: value|Label|plural
 * e.g. "kurs|Kurs|kurs". Admin can add new event types without code changes.
 */
export function parseCourseTypes(value: string | undefined): CourseType[] {
  return settingToList(value)
    .map((line) => {
      const [typeValue, label, plural] = line.split('|').map((s) => s.trim());
      if (!typeValue) return null;
      return {
        value: typeValue.toLowerCase(),
        label: label || typeValue,
        plural: plural || label || typeValue,
      };
    })
    .filter((t): t is CourseType => t !== null);
}

/**
 * Display label for a course type. Unknown types fall back to a
 * capitalized value so old data never breaks rendering.
 */
export function courseTypeLabel(types: CourseType[], value: string): string {
  const match = types.find((t) => t.value === value);
  if (match) return match.label;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'superadmin';
}

export function isSuperAdmin(role: string | undefined): boolean {
  return role === 'superadmin';
}
