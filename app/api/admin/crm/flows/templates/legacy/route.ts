import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/activity';
import { getBaseUrl } from '@/lib/site';
import logger from '@/lib/logger';
import { importLegacyCourseTemplates, TemplateInstallError } from '@/lib/flows/templates/install';
import { parseTemplateRequest } from '../request';

// «Importer gamle kursmaler»: leser legacy-tabellen email_templates og lager en livssyklus-mal med originaltekstene.
export async function POST(request: NextRequest) {
  const parsed = await parseTemplateRequest(request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await importLegacyCourseTemplates(prisma, {
      senderIdentityId: parsed.senderIdentityId,
      siteUrl: getBaseUrl(),
    });
    if (result.status === 'created') {
      logActivity({
        action: 'import_legacy_templates',
        entity: 'flow',
        entityId: result.flowId,
        details: JSON.stringify({ matched: result.matched.length, unmatched: result.unmatched.length }),
        userEmail: parsed.email,
      }).catch(() => {});
    }
    return NextResponse.json(result, { status: result.status === 'created' ? 201 : 200 });
  } catch (error) {
    if (error instanceof TemplateInstallError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error('Import av gamle kursmaler feilet', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Kunne ikke lese de gamle kursmalene' }, { status: 500 });
  }
}
