import { redirect } from 'next/navigation';

// Root redirects to admin; middleware handles the /login redirect if not authed.
export default function Home() {
  redirect('/admin');
}
