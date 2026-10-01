import { redirect } from 'next/navigation';

/** «Mine bookinger» er slått sammen med Min side; gamle lenker (e-post, bokmerker) havner på riktig seksjon. */
export default function MineBookingerPage() {
  redirect('/dashboard#foresporsler');
}
