import { describe, it, expect } from 'vitest';
import { dueRegistrationsWhere } from '@/app/api/cron/email-triggers/route';

describe('dueRegistrationsWhere', () => {
  it('inkluderer courseId, status, emailLogs-none OG flowEnrollments-none', () => {
    const w = dueRegistrationsWhere({ id: 11, courseId: 3 });
    expect(w.courseId).toBe(3);
    expect(w.status).toEqual({ in: ['pending', 'confirmed'] });
    expect(w.emailLogs).toEqual({ none: { triggerId: 11 } });
    // Parallelldrift: flyt-eide registreringer utelates fra legacy.
    expect(w.flowEnrollments).toEqual({ none: {} });
  });
});
