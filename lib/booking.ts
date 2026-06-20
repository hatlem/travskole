export interface RequestConsentConfig {
  requestConsentRisk: boolean;
  requestConsentTerms: boolean;
  requestConsentMedia: boolean;
  requestConsentActivities: boolean;
}

export interface SubmittedConsents {
  consentRisk: boolean;
  consentTerms: boolean;
  consentMedia: boolean;
  consentActivities: boolean;
}

export interface RequiredConsents {
  risk: boolean;
  terms: boolean;
  media: boolean;
  activities: boolean;
}

export function requiredRequestConsents(c: RequestConsentConfig): RequiredConsents {
  return {
    risk: c.requestConsentRisk,
    terms: c.requestConsentTerms,
    media: c.requestConsentMedia,
    activities: c.requestConsentActivities,
  };
}

// Enabled consents are required, except media (optional). Returns an error
// message if a required consent is missing, else null.
export function bookingConsentError(c: RequestConsentConfig, s: SubmittedConsents): string | null {
  const req = requiredRequestConsents(c);
  if (req.risk && !s.consentRisk) return 'Du må bekrefte at du har lest og forstått forsikringsvilkårene';
  if (req.terms && !s.consentTerms) return 'Du må godta vilkårene for å sende forespørsel';
  if (req.activities && !s.consentActivities) return 'Du må samtykke til aktiviteter for å sende forespørsel';
  return null;
}
