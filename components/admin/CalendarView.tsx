'use client';

import { useState, useMemo } from 'react';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { useRouter } from 'next/navigation';

interface CalendarCourse {
  id: number;
  name: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string | null;
}

interface CalendarViewProps {
  courses: CalendarCourse[];
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Desember',
];

const DAY_NAMES = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lor', 'Son'];

const statusDot: Record<string, string> = {
  open: 'bg-green-500',
  full: 'bg-yellow-500',
  closed: 'bg-red-500',
};

const typeBg: Record<string, string> = {
  kurs: 'bg-blue-100 text-blue-800 border-blue-200',
  leir: 'bg-purple-100 text-purple-800 border-purple-200',
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  // Convert Sunday=0 to Monday-based (Mon=0, Sun=6)
  return day === 0 ? 6 : day - 1;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function CalendarView({ courses }: CalendarViewProps) {
  const settings = useSettings();
  const courseTypes = parseCourseTypes(settings.course_types);
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const coursesByDay = useMemo(() => {
    const map: Record<number, CalendarCourse[]> = {};
    for (const course of courses) {
      const start = new Date(course.startDate);
      if (start.getFullYear() === year && start.getMonth() === month) {
        const day = start.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(course);
      }
    }
    return map;
  }, [courses, year, month]);

  // Mobile: list of courses this month sorted by date
  const monthCourses = useMemo(() => {
    return courses
      .filter((c) => {
        const d = new Date(c.startDate);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }, [courses, year, month]);

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to complete last week
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (day: number) =>
    isSameDay(new Date(year, month, day), today);

  return (
    <div>
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Forrige m&aring;ned"
          >
            <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Neste m&aring;ned"
          >
            <svg className="h-5 w-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        <button
          onClick={goToToday}
          className="text-sm font-medium text-bjerke-blue hover:underline"
        >
          I dag
        </button>
      </div>

      {/* Desktop grid */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
          {DAY_NAMES.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const dayCourses = day ? coursesByDay[day] || [] : [];
            const todayCell = day ? isToday(day) : false;

            return (
              <div
                key={idx}
                className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 ${
                  day ? 'bg-white' : 'bg-gray-50'
                }`}
              >
                {day && (
                  <>
                    <div
                      className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                        todayCell
                          ? 'bg-bjerke-blue text-white'
                          : 'text-gray-700'
                      }`}
                    >
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayCourses.map((course) => (
                        <button
                          key={course.id}
                          onClick={() => router.push(`/admin/courses/${course.id}`)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-xs font-medium truncate border flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer ${
                            typeBg[course.type] || 'bg-gray-100 text-gray-800 border-gray-200'
                          }`}
                          title={course.name}
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              statusDot[course.status] || 'bg-gray-400'
                            }`}
                          />
                          <span className="truncate">{course.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile list view */}
      <div className="md:hidden">
        {monthCourses.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-500 text-sm">Ingen kurs denne m&aring;neden.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {monthCourses.map((course) => {
              const startDate = new Date(course.startDate);
              const dayNum = startDate.getDate();
              const todayItem = isSameDay(startDate, today);

              return (
                <button
                  key={course.id}
                  onClick={() => router.push(`/admin/courses/${course.id}`)}
                  className="w-full text-left bg-white rounded-xl shadow-sm border border-gray-200 p-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div
                    className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-semibold flex-shrink-0 ${
                      todayItem
                        ? 'bg-bjerke-blue text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    <span className="text-[10px] leading-none uppercase">
                      {DAY_NAMES[startDate.getDay() === 0 ? 6 : startDate.getDay() - 1]}
                    </span>
                    <span className="text-sm leading-none">{dayNum}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {course.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          statusDot[course.status] || 'bg-gray-400'
                        }`}
                      />
                      <span
                        className={`text-xs font-medium ${
                          course.type === 'leir' ? 'text-purple-700' : 'text-blue-700'
                        }`}
                      >
                        {courseTypeLabel(courseTypes, course.type)}
                      </span>
                    </div>
                  </div>
                  <svg
                    className="h-4 w-4 text-gray-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-blue-100 border border-blue-200" />
          Kurs
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-purple-100 border border-purple-200" />
          Leir
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          &Aring;pen
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          Fullt
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Stengt
        </div>
      </div>
    </div>
  );
}
