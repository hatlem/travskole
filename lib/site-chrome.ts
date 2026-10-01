/** Sider der den flytende tilbakemeldingsboblen ville dekket skjemafelt eller handlinger på mobil. */
const FORM_PATHS = [
  /\/pamelding(\/|$)/,
  /^\/dashboard/,
  /^\/login/,
  /^\/register/,
  /^\/betaling/,
  /^\/arrangementer\/[^/]+\/[^/]+\/[^/]+$/,
];

export function hidesFloatingFeedbackOnMobile(pathname: string | null | undefined): boolean {
  return !!pathname && FORM_PATHS.some((re) => re.test(pathname));
}
