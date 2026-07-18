// Nappe — configuracion de cliente.
// Rellena estos dos valores despues de crear el proyecto Supabase.
// No hay build step: estos valores viajan al navegador tal cual, por
// eso solo la anon key (publica por diseño) vive aqui. La API key de
// Anthropic NUNCA va en este archivo ni en ningun otro del cliente —
// vive como variable de entorno de Netlify, leida solo por las
// Netlify Functions en netlify/functions/.

export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';
