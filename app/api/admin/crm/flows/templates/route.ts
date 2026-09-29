import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/activity';
import { getBaseUrl } from '@/lib/site';
import { installStandardTemplates, TemplateInstallError } from '@/lib/flows/templates/install';
import { parseTemplateRequest } from './request';

// «Legg til standardmaler»: setter inn de innebygde malene som mangler (idempotent på navn).
export async function POST(request: NextRequest) {
  const parsed = await parseTemplateRequest(request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await installStandardTemplates(prisma, {
      senderIdentityId: parsed.senderIdentityId,
      siteUrl: getBaseUrl(),
    });
    for (const flow of result.created) {
      logActivity({
        action: 'install_standard_template',
        entity: 'flow',
        entityId: flow.id,
        userEmail: parsed.email,
      }).catch(() => {});
    }
    return NextResponse.json(result, { status: result.created.length > 0 ? 201 : 200 });
  } catch (error) {
    if (error instanceof TemplateInstallError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
