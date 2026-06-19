import { redirect } from 'next/navigation';

// Page d'entrée : on arrive directement sur les dernières annonces.
export default function Home() {
  redirect('/listings');
}
