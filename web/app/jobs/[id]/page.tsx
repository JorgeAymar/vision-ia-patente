import { redirect } from 'next/navigation';

// Esta ruta ya no existe como pantalla propia (todo vive en '/'), pero se
// deja este redirect por si quedó un tab/bookmark viejo apuntando aquí.
export default function LegacyJobRedirect() {
  redirect('/');
}
