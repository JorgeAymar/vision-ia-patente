import { redirect } from 'next/navigation';

// Esta ruta ya no existe como pantalla propia (la app de EPP vive en '/epp',
// ya que '/' ahora es el detector de patentes), pero se deja este redirect
// por si quedó un tab/bookmark viejo apuntando aquí.
export default function LegacyJobRedirect() {
  redirect('/epp');
}
