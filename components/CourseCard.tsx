import React from 'react';
import Link from 'next/link';

export interface Course {
  id: string;
  name: string;
  description: string;
  type: 'kurs' | 'leir';
  start_date: string;
  end_date?: string;
  age_min?: number;
  age_max?: number;
  price: number;
  max_participants: number;
  status: 'open' | 'full' | 'closed';
}

interface CourseCardProps {
  course: Course;
}

export default function CourseCard({ course }: CourseCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('nb-NO', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const getStatusBadge = () => {
    switch (course.status) {
      case 'full':
        return <span className="text-sm font-medium text-red-600">Fullt</span>;
      case 'closed':
        return <span className="text-sm font-medium text-gray-600">Stengt</span>;
      default:
        return <span className="text-sm font-medium text-green-600">Ledige plasser</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4 hover:shadow-md transition">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-2xl font-semibold text-gray-900 mb-1">
            {course.name}
          </h3>
          <span className="inline-block px-3 py-1 text-sm font-medium text-[#003B7A] bg-blue-50 rounded-full">
            {course.type === 'kurs' ? 'Kurs' : 'Leir'}
          </span>
        </div>
        {getStatusBadge()}
      </div>
      
      <p className="text-gray-600 mb-4">{course.description}</p>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-500">Startdato</p>
          <p className="font-semibold">{formatDate(course.start_date)}</p>
        </div>
        {course.end_date && (
          <div>
            <p className="text-sm text-gray-500">Sluttdato</p>
            <p className="font-semibold">{formatDate(course.end_date)}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-gray-500">Aldersgruppe</p>
          <p className="font-semibold">
            {course.age_min && course.age_max 
              ? `${course.age_min}-${course.age_max} år`
              : 'Alle aldre'}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Pris</p>
          <p className="font-semibold">
            {course.price === 0 ? 'Gratis' : `${course.price} kr`}
          </p>
        </div>
      </div>
      
      <Link 
        href={`/courses/${course.id}`}
        className={`inline-block w-full text-center px-6 py-3 rounded-lg font-semibold transition ${
          course.status === 'open' 
            ? 'bg-[#003B7A] hover:bg-[#002855] text-white' 
            : 'bg-gray-200 text-gray-600 cursor-not-allowed'
        }`}
      >
        {course.status === 'open' ? 'Se detaljer og meld på' : 'Se detaljer'}
      </Link>
    </div>
  );
}
