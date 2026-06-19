/**
 * Brand colors as literal values for contexts where CSS variables are
 * unavailable (ImageResponse: icons, opengraph images).
 *
 * For everything rendered in the DOM, use the Tailwind tokens instead
 * (bg-bjerke-blue, text-bjerke-blue-dark, ...) defined in app/globals.css.
 * Keep these values in sync with the :root variables there.
 */
export const BRAND = {
  blue: '#003B7A',
  blueDark: '#002855',
  blueLight: '#0052A3',
} as const;
