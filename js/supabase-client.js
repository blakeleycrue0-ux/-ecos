// Nappe — cliente Supabase compartido por toda la app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Devuelve la sesion actual o null. No redirige.
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// Exige sesion; si no hay, redirige a index.html. Devuelve el usuario.
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session.user;
}

// Carga (o crea perezosamente) la fila de profiles del usuario actual.
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getProfile(user.id);
  if (!profile || !profile.is_admin) {
    window.location.href = 'app.html';
    return null;
  }
  return user;
}
