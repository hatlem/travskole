import Hero from '@/components/Hero';
import CourseCard, { Course } from '@/components/CourseCard';
import Link from 'next/link';

// Mock data - replace with database query
async function getUpcomingCourses(): Promise<Course[]> {
  // In production, fetch from database
  return [
    {
      id: '1',
      name: 'Påskeleir 2026',
      description: 'En fantastisk uke med hester, aktiviteter og nye venner. Perfekt for barn som elsker hester!',
      type: 'leir',
      start_date: '2026-04-06',
      end_date: '2026-04-10',
      age_min: 8,
      age_max: 14,
      price: 4500,
      max_participants: 20,
      status: 'open'
    },
    {
      id: '2',
      name: 'Travkurs for nybegynnere',
      description: 'Lær grunnleggende om travhester, utstyr og sikkerhet. Ingen forkunnskaper nødvendig!',
      type: 'kurs',
      start_date: '2026-03-15',
      age_min: 10,
      age_max: 16,
      price: 1200,
      max_participants: 12,
      status: 'open'
    },
    {
      id: '3',
      name: 'Sommerleir 2026',
      description: 'Sommerens høydepunkt! En uke med ridning, stell og morsomme aktiviteter i strålende sol.',
      type: 'leir',
      start_date: '2026-07-01',
      end_date: '2026-07-05',
      age_min: 7,
      age_max: 15,
      price: 5000,
      max_participants: 25,
      status: 'open'
    }
  ];
}

export default async function Home() {
  const upcomingCourses = await getUpcomingCourses();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <Hero 
        title="Velkommen til Bjerke Travskole"
        subtitle="Opplev gleden ved travsporten i trygge og profesjonelle omgivelser. Vi tilbyr kurs og leirer for barn og unge."
        ctaText="Se alle kurs"
        ctaLink="/courses"
      />

      {/* Kommende Kurs Section */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-4xl font-bold text-gray-900">Kommende kurs og leirer</h2>
          <Link 
            href="/courses" 
            className="text-[#003B7A] hover:underline font-semibold"
          >
            Se alle →
          </Link>
        </div>
        
        <div className="grid gap-6 md:grid-cols-1">
          {upcomingCourses.slice(0, 3).map(course => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </section>

      {/* Om Oss Section */}
      <section className="bg-white py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-4xl font-bold text-gray-900 mb-6">Om Bjerke Travskole</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Vår visjon</h3>
              <p className="text-gray-600 leading-relaxed">
                Bjerke Travskole drives av Bjerke Travbane og er en trygg og engasjerende arena for 
                barn og unge som ønsker å lære mer om travhester og travsport. Vi legger vekt på sikkerhet, 
                dyrevelferd og gode opplevelser.
              </p>
            </div>
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Hva vi tilbyr</h3>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2">✓</span>
                  Profesjonelle instruktører med lang erfaring
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2">✓</span>
                  Trygge og vennlige travhester
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2">✓</span>
                  Moderne fasiliteter og utstyr
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2">✓</span>
                  Fokus på læring, sikkerhet og moro
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-[#003B7A] py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">Klar for å bli med?</h2>
          <p className="text-xl text-blue-100 mb-8">
            Meld deg på et kurs eller en leir i dag, og opplev magien med travhester!
          </p>
          <Link 
            href="/courses" 
            className="inline-block bg-white text-[#003B7A] px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-100 transition"
          >
            Se våre kurs
          </Link>
        </div>
      </section>
    </div>
  );
}
