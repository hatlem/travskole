// Ren import-planlegging: rader + kolonnemapping + eksisterende e-poster
// → create/update/skip-plan. DB-siden ligger i API-ruta.

import { normalizeEmail } from '@/lib/crm/normalize';

export interface ImportMapping {
  name: number | null;
  email: number | null;
  phone: number | null;
  organization: number | null;
}

export interface ImportRow {
  row: number; // 1-basert radnummer i fila (uten header)
  name: string;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
}

export interface ImportPlan {
  create: ImportRow[];
  update: ImportRow[];
  skip: { row: number; reason: string }[];
}

// parseCsv (Task 4) kun trimmer header-rader, ikke datarader — trim her.
function cell(row: string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) return '';
  return row[index].trim();
}

export function planImport(
  rows: string[][],
  mapping: ImportMapping,
  existingEmails: Set<string>,
): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], skip: [] };
  const seenInFile = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNum = i + 1;
    const rawName = cell(raw, mapping.name);
    const email = normalizeEmail(cell(raw, mapping.email));
    const phone = cell(raw, mapping.phone) || null;
    const organizationName = cell(raw, mapping.organization) || null;

    if (!rawName && !email) {
      plan.skip.push({ row: rowNum, reason: 'mangler navn og e-post' });
      return;
    }
    if (email && seenInFile.has(email)) {
      plan.skip.push({ row: rowNum, reason: 'duplikat i filen' });
      return;
    }
    if (email) seenInFile.add(email);

    const name = rawName || email!.split('@')[0];
    const item: ImportRow = { row: rowNum, name, email, phone, organizationName };

    if (email && existingEmails.has(email)) plan.update.push(item);
    else plan.create.push(item);
  });

  return plan;
}
