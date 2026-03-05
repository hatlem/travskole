import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { registrationLimiter, checkRateLimit } from '@/lib/rate-limiter';
import { logRegistration, logRateLimitExceeded } from '@/lib/logger';

// Types
interface RegistrationData {
  courseId: string;
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

interface Registration {
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

// Mock database - replace with real database
const registrations: Registration[] = [];

// Mock course data
const courses: Record<string, { name: string }> = {
  '1': { name: 'Påskeleir 2026' },
  '2': { name: 'Travkurs for nybegynnere' },
  '3': { name: 'Sommerleir 2026' }
};

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

    // Validate required fields
    if (!data.courseId || !data.parentName || !data.parentEmail || !data.parentPhone) {
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

    // Determine child info
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
      childName = data.childName;
      childBirthdate = data.childBirthdate;
      childAllergies = data.childAllergies;
    } else {
      // Fetch existing child from database
      // For now, use mock data
      if (!data.existingChildId) {
        return NextResponse.json(
          { error: 'Vennligst velg et barn' },
          { status: 400 }
        );
      }
      // Mock fetch
      childName = 'Emma Hansen'; // Would fetch from DB
      childBirthdate = '2014-05-12';
      childAllergies = undefined;
    }

    // Get course name
    const courseName = courses[data.courseId]?.name || 'Ukjent kurs';

    // Create registration
    const registration: Registration = {
      id: `reg_${Date.now()}`,
      courseId: data.courseId,
      courseName,
      childName,
      childBirthdate,
      parentName: data.parentName,
      parentEmail: data.parentEmail,
      parentPhone: data.parentPhone,
      allergies: childAllergies,
      consentActivities: data.consentActivities,
      consentMedia: data.consentMedia,
      consentRisk: data.consentRisk,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Save to mock database
    registrations.push(registration);

    // SECURITY: Log registration
    logRegistration(data.parentEmail, data.courseId);

    // Send confirmation email to parent
    await sendParentConfirmationEmail(registration);

    // Send notification email to admin
    await sendAdminNotificationEmail(registration);

    return NextResponse.json({
      success: true,
      registration: {
        id: registration.id,
        status: registration.status
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

    // Filter registrations
    let filtered = [...registrations];

    if (courseId) {
      filtered = filtered.filter(r => r.courseId === courseId);
    }

    if (status) {
      filtered = filtered.filter(r => r.status === status);
    }

    // Sort by newest first
    filtered.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      registrations: filtered,
      total: filtered.length
    });

  } catch (error) {
    console.error('Get registrations error:', error);
    return NextResponse.json(
      { error: 'En intern feil oppstod' },
      { status: 500 }
    );
  }
}

/**
 * Send confirmation email to parent
 */
async function sendParentConfirmationEmail(registration: Registration) {
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
async function sendAdminNotificationEmail(registration: Registration) {
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
