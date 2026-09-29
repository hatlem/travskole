// Forhåndsvisning/test-utsending av per-mottaker-personalisering: samme
// rendring og samme KI-vei som lib/flows/send.ts, men uten å sende noe.
import { prisma } from '@/lib/prisma';
import { replaceMergeTags } from '@/lib/email-templates';
import { contactMergeTagData } from '@/lib/flows/send';
import type { LLMProvider } from './provider';
import { personalizeForContact } from './personalize';

export interface PersonalizationPreview {
  contact: { id: number; name: string };
  subject: string;
  originalBody: string;
  personalizedBody: string | null;
  verdict: { ok: true } | { ok: false; reason: string };
  factLines: string[];
}

export async function previewPersonalization(
  provider: LLMProvider,
  contactId: number,
  subject: string,
  bodyHtml: string,
): Promise<PersonalizationPreview | null> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true } });
  if (!contact) return null;
  const mergeData = contactMergeTagData(contact);
  const renderedSubject = replaceMergeTags(subject, mergeData);
  const originalBody = replaceMergeTags(bodyHtml, mergeData);
  const outcome = await personalizeForContact(provider, contact.id, originalBody);
  return {
    contact,
    subject: renderedSubject,
    originalBody,
    personalizedBody: outcome.ok ? outcome.body : null,
    verdict: outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason },
    factLines: outcome.factLines,
  };
}
