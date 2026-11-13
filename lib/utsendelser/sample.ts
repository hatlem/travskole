/** Hvem eksempelvisningen gjelder, lesbart for den som ser på siden. */
export function sampleLabel(sample: { name: string; email: string | null; organization: { name: string } | null }): string {
  const name = sample.name.trim();
  const org = sample.organization?.name.trim() || null;
  const localPart = sample.email?.split('@')[0].toLowerCase() ?? null;
  const isPerson = /\s/.test(name) && name.toLowerCase() !== localPart;

  if (isPerson) return org ? `${name} i ${org}` : name;
  const address = sample.email ?? name;
  return org ? `${address} (${org})` : address;
}
