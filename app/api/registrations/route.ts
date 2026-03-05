import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { registrationLimiter, checkRateLimit } from '@/lib/rate-limiter';
import { logRegistration, logRateLimitExceeded } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';

interface RegistrationData {
  courseType: string;
  courseYear: string;
  courseSlug: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  childSelection: 'existing' | 'new';
  existingChildId?: string;
  childName?: string;
  childBirthdate?: string;
  childAllergies?: string;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
}

/**
 * POST /api/registrations
 * Create a new registration and send confirmation emails
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = await checkRateLimit(registrationLimiter, ip);
    
    if (!rateLimit.allowed) {
      logRateLimitExceeded('/api/registrations', ip);
      return NextResponse.json(
        { error: rateLimit.error },
        { status: 429 }
      );
    }

    const data: RegistrationData = await request.json();

    // SECURITY: Backend validation with Zod
    const emailSchema = z.string().email();
    const phoneSchema = z.string().min(8);
    const nameSchema = z.string().min(2).max(100);

    // Validate email
    const emailValidation = emailSchema.safeParse(data.parentEmail);
    if (!emailValidation.success) {
      return NextResponse.json(
        { error: 'Ugyldig e-postadresse' },
        { status: 400 }
      );
    }

    // Validate phone
    const phoneValidation = phoneSchema.safeParse(data.parentPhone);
    if (!phoneValidation.success) {
      return NextResponse.json(
        { error: 'Ugyldig telefonnummer' },
        { status: 400 }
      );
    }

    if (!data.courseType || !data.courseYear || !data.courseSlug || !data.parentName || !data.parentEmail || !data.parentPhone) {
      return NextResponse.json(
        { error: 'Manglende påkrevde felter' },
        { status: 400 }
      );
    }

    // SECURITY: Sanitize user input to prevent XSS
    data.parentName = DOMPurify.sanitize(data.parentName);
    if (data.childName) {
      data.childName = DOMPurify.sanitize(data.childName);
    }
    if (data.childAllergies) {
      data.childAllergies = DOMPurify.sanitize(data.childAllergies);
    }

    // Validate consents
    if (!data.consentActivities || !data.consentRisk) {
      return NextResponse.json(
        { error: 'Du må godta alle påkrevde samtykker' },
        { status: 400 }
      );
    }

    let course = await prisma.course.findFirst({
      where: { type: data.courseType, slug: data.courseSlug },
    });

    if (!course) {
      const allCourses = await prisma.course.findMany({
        where: { type: data.courseType },
      });
      course = allCourses.find((c) => generateSlug(c.name) === data.courseSlug) ?? null;
    }

    if (!course) {
      return NextResponse.json(
        { error: 'Kurset finnes ikke' },
        { status: 404 }
      );
    }

    const courseYear = new Date(course.startDate).getFullYear().toString();
    if (courseYear !== data.courseYear) {
      return NextResponse.json(
        { error: 'Kurset finnes ikke for dette året' },
        { status: 404 }
      );
    }

    if (course.status !== 'open') {
      return NextResponse.json(
        { error: 'Kurset er ikke åpent for påmelding' },
        { status: 400 }
      );
    }

    // Find or create user + parent
    let user = await prisma.user.findUnique({ where: { email: data.parentEmail } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: data.parentEmail,
          role: 'parent',
        },
      });
    }

    let parent = await prisma.parent.findUnique({ where: { userId: user.id } });
    if (!parent) {
      parent = await prisma.parent.create({
        data: {
          userId: user.id,
          name: data.parentName,
          phone: data.parentPhone,
        },
      });
    }

    // Determine child
    let childId: number;
    let childName: string;
    let childBirthdate: string;
    let childAllergies: string | undefined;

    if (data.childSelection === 'new') {
      if (!data.childName || !data.childBirthdate) {
        return NextResponse.json(
          { error: 'Barnets navn og fødselsdato er påkrevd' },
          { status: 400 }
        );
      }
      const child = await prisma.child.create({
        data: {
          parentId: parent.id,
          name: data.childName,
          birthdate: new Date(data.childBirthdate),
          allergies: data.childAllergies || null,
        },
      });
      childId = child.id;
      childName = child.name;
      childBirthdate = data.childBirthdate;
      childAllergies = data.childAllergies;
    } else {
      if (!data.existingChildId) {
        return NextResponse.json(
          { error: 'Vennligst velg et barn' },
          { status: 400 }
        );
      }
      const existingChildId = parseInt(data.existingChildId, 10);
      const child = await prisma.child.findUnique({ where: { id: existingChildId } });
      if (!child || child.parentId !== parent.id) {
        return NextResponse.json(
          { error: 'Barnet ble ikke funnet' },
          { status: 404 }
        );
      }
      childId = child.id;
      childName = child.name;
      childBirthdate = child.birthdate ? child.birthdate.toISOString().split('T')[0] : '';
      childAllergies = child.allergies ?? undefined;
    }

    // Create registration in database
    const registration = await prisma.registration.create({
      data: {
        courseId: course.id,
        childId,
        parentId: parent.id,
        consentActivities: data.consentActivities,
        consentMedia: data.consentMedia,
        consentRisk: data.consentRisk,
        status: 'pending',
      },
    });

    // SECURITY: Log registration
    logRegistration(data.parentEmail, course.slug || data.courseSlug);

    // Build email-friendly object
    const emailData = {
      id: String(registration.id),
      courseId: String(course.id),
      courseName: course.name,
      childName,
      childBirthdate,
      parentName: data.parentName,
      parentEmail: data.parentEmail,
      parentPhone: data.parentPhone,
      allergies: childAllergies,
      consentActivities: data.consentActivities,
      consentMedia: data.consentMedia,
      consentRisk: data.consentRisk,
      status: 'pending' as const,
      createdAt: registration.createdAt.toISOString(),
    };

    // Send confirmation email to parent
    await sendParentConfirmationEmail(emailData);

    // Send notification email to admin
    await sendAdminNotificationEmail(emailData);

    return NextResponse.json({
      success: true,
      registration: {
        id: String(registration.id),
        status: registration.status,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'En intern feil oppstod. Vennligst prøv igjen senere.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/registrations
 * List all registrations (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // SECURITY: Admin authentication required
    const { getServerSession } = await import('@/lib/auth');
    const session = await getServerSession();
    
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query params for filtering
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId');
    const status = searchParams.get('status');

    // Build Prisma where clause
    const where: Record<string, unknown> = {};
    if (courseId) {
      const numCourseId = parseInt(courseId, 10);
      if (!isNaN(numCourseId)) where.courseId = numCourseId;
    }
    if (status) {
      where.status = status;
    }

    const registrations = await prisma.registration.findMany({
      where,
      include: {
        course: true,
        child: true,
        parent: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      registrations: registrations.map((r) => ({
        id: String(r.id),
        courseId: String(r.courseId),
        courseName: r.course.name,
        childName: r.child.name,
        childBirthdate: r.child.birthdate ? r.child.birthdate.toISOString().split('T')[0] : '',
        parentName: r.parent.name,
        parentPhone: r.parent.phone,
        allergies: r.child.allergies ?? undefined,
        consentActivities: r.consentActivities,
        consentMedia: r.consentMedia,
        consentRisk: r.consentRisk,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total: registrations.length,
    });

  } catch (error) {
    console.error('Get registrations error:', error);
    return NextResponse.json(
      { error: 'En intern feil oppstod' },
      { status: 500 }
    );
  }
}

interface EmailRegistration {
  id: string;
  courseId: string;
  courseName: string;
  childName: string;
  childBirthdate: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  allergies?: string;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

/**
 * Send confirmation email to parent
 */
async function sendParentConfirmationEmail(registration: EmailRegistration) {
  // In production, use actual SMTP service (Nodemailer, SendGrid, etc.)
  console.log('📧 Sending confirmation email to parent:', registration.parentEmail);
  console.log('Subject: Påmelding mottatt -', registration.courseName);
  console.log('Body:');
  console.log(`
    Hei ${registration.parentName}!
    
    Takk for påmeldingen til ${registration.courseName}.
    
    Barn: ${registration.childName}
    Fødselsdato: ${new Date(registration.childBirthdate).toLocaleDateString('nb-NO')}
    ${registration.allergies ? `Allergier: ${registration.allergies}` : ''}
    
    Vi vil sende deg en bekreftelse så snart vi har behandlet påmeldingen.
    
    Spørsmål? Ta kontakt med oss på travskole@bjerke.no
    
    Med vennlig hilsen,
    Bjerke Travskole
  `);

  // TODO: Implement actual email sending
  // await sendEmail({
  //   to: registration.parentEmail,
  //   subject: `Påmelding mottatt - ${registration.courseName}`,
  //   html: emailTemplate
  // });
}

/**
 * Send notification email to admin
 */
async function sendAdminNotificationEmail(registration: EmailRegistration) {
  // In production, use actual SMTP service
  console.log('📧 Sending notification email to admin');
  console.log('Subject: Ny påmelding -', registration.courseName);
  console.log('Body:');
  console.log(`
    Ny påmelding mottatt!
    
    Kurs: ${registration.courseName}
    Barn: ${registration.childName} (født ${new Date(registration.childBirthdate).toLocaleDateString('nb-NO')})
    Forelder: ${registration.parentName}
    E-post: ${registration.parentEmail}
    Telefon: ${registration.parentPhone}
    ${registration.allergies ? `Allergier: ${registration.allergies}` : 'Ingen allergier oppgitt'}
    
    Status: Venter på godkjenning
    
    Logg inn på admin-panelet for å godkjenne: [ADMIN_URL]
  `);

  // TODO: Implement actual email sending
  // await sendEmail({
  //   to: 'admin@bjerke.no',
  //   subject: `Ny påmelding - ${registration.courseName}`,
  //   html: emailTemplate
  // });
}
