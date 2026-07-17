import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { sendMailAs } from '@/lib/mail';
import { replaceMergeTags, wrapEmailHtml, type MergeTagData } from '@/lib/email-templates';
import { parseNodeConfig } from '@/lib/flows/graph';
import { normalizeEmail } from '@/lib/crm/normalize';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

// Deliberately distinct from the "Kari Nordmann"-style preview sample in
// email-templates.ts — every value here screams "placeholder" so a test
// send is never mistaken for a real one in an inbox.
const TEST_MERGE_DATA: MergeTagData = {
  forelder_navn: 'Test Testesen',
  barnets_navn: 'Test Testesen',
  kurs_navn: 'Testkurs',
  kurs_startdato: '01.01.2026',
  kurs_sluttdato: '01.06.2026',
  allergier: 'Ingen',
  kontakt_epost: 'test@bjerke.no',
};

const TEST_BANNER =
  '<div style="background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:6px;' +
  'font-size:13px;font-weight:600;margin-bottom:16px">' +
  '[Testutsending] — dette er en test og teller ikke som en reell utsending.</div>';

// `MessageSend.contactId` is a required FK — a test send has no real
// recipient contact, so we attach it to a single dedicated system contact
// instead of fabricating (or worse, guessing/reusing) a real one. This
// contact is never enrolled in anything — enroll.ts is never called from
// this route — so it can never receive a real flow email; it exists purely
// so the MessageSend audit row has somewhere to point. Upserted idempotently
// on first use, same pattern as the sender-identity seed.
const TEST_SEND_CONTACT_EMAIL = 'flow-test-send@system.invalid';

async function ensureTestSendContactId(): Promise<number> {
  const contact = await prisma.contact.upsert({
    where: { email: TEST_SEND_CONTACT_EMAIL },
    create: {
      email: TEST_SEND_CONTACT_EMAIL,
      name: 'Testutsending (system)',
      source: 'system',
    },
    update: {},
    select: { id: true },
  });
  return contact.id;
}

const testSendSchema = z.object({
  nodeId: z.number().int().positive(),
  toEmail: z.string().email('Ugyldig e-postadresse'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = testSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const toEmail = normalizeEmail(parsed.data.toEmail);
  if (!toEmail) {
    return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
  }

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  const node = await prisma.flowNode.findUnique({ where: { id: parsed.data.nodeId } });
  if (!node || node.flowId !== flowId || node.type !== 'email') {
    return NextResponse.json(
      { error: 'Noden finnes ikke i denne flyten eller er ikke en e-post-node' },
      { status: 400 },
    );
  }

  const config = parseNodeConfig(node.config);
  const { subject, bodyHtml, senderIdentityId } = config;
  if (
    typeof subject !== 'string' || !subject.trim() ||
    typeof bodyHtml !== 'string' || !bodyHtml.trim() ||
    typeof senderIdentityId !== 'number' || !Number.isInteger(senderIdentityId)
  ) {
    return NextResponse.json(
      { error: 'E-post-noden mangler emne, innhold eller avsender' },
      { status: 400 },
    );
  }

  const identity = await prisma.senderIdentity.findUnique({ where: { id: senderIdentityId } });
  if (!identity || !identity.active) {
    return NextResponse.json(
      { error: 'Avsenderidentiteten finnes ikke eller er inaktiv' },
      { status: 400 },
    );
  }

  const renderedSubject = replaceMergeTags(subject, TEST_MERGE_DATA);
  const renderedBody = replaceMergeTags(bodyHtml, TEST_MERGE_DATA);
  const html = wrapEmailHtml(TEST_BANNER + renderedBody, identity.displayName);

  const testContactId = await ensureTestSendContactId();

  const messageSend = await prisma.messageSend.create({
    data: {
      nodeId: node.id,
      contactId: testContactId,
      senderIdentityId: identity.id,
      toEmail,
      subject: renderedSubject,
      bodyHtml: html,
      status: 'test',
      dedupeKey: null,
    },
  });

  try {
    await sendMailAs({
      from: identity.email,
      replyTo: identity.email,
      to: toEmail,
      subject: renderedSubject,
      html,
    });
    logActivity({ action: 'flow_test_send', entity: 'flow', entityId: flowId, details: JSON.stringify({ nodeId: node.id, toEmail }), userEmail: session.user.email }).catch(() => {});
  } catch (error) {
    logger.error('Test-utsending feilet', {
      flowId,
      nodeId: node.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await prisma.messageSend.update({
      where: { id: messageSend.id },
      data: { status: 'failed' },
    });
    return NextResponse.json({ error: 'Kunne ikke sende test-e-post' }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}
