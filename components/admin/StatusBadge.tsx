import type { ReactNode } from 'react';
import { COURSE_DISPLAY_STATUS, type CourseDisplayStatus } from '@/lib/course-status';

/** Statusmerke: farge + tekst (aldri bare farge). Grønt brukes bare her, ikke på knapper. */
export function Badge({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function CourseStatusBadge({ status }: { status: CourseDisplayStatus }) {
  const s = COURSE_DISPLAY_STATUS[status];
  return (
    <Badge className={s.className} title={s.hint}>
      {s.label}
    </Badge>
  );
}
