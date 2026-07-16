// Ren beslutningslogikk for identity stitching: skal en anonym Visitor
// kobles til en Contact? Første identifisering vinner — en Visitor som
// allerede er koblet, kobles aldri om.

export type StitchPlan = { link: false } | { link: true; visitorId: number; contactId: number };

export function planStitch(
  visitor: { id: number; contactId: number | null } | null,
  contactId: number | null
): StitchPlan {
  if (!visitor) return { link: false };
  if (visitor.contactId !== null) return { link: false };
  if (contactId === null) return { link: false };
  return { link: true, visitorId: visitor.id, contactId };
}
