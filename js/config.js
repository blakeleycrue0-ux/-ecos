// Nappe — configuracion de cliente.
// Rellena estos tres valores despues de crear el proyecto Supabase
// y desplegar el Worker de Cloudflare. No hay build step: estos
// valores viajan al navegador tal cual, por eso solo la anon key
// (publica por diseño) vive aqui. La API key de Anthropic NUNCA va
// en este archivo ni en ningun otro del cliente.

export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-SUPABASE-ANON-KEY';

// URL base del Worker de Cloudflare, sin barra final.
// Ejemplo: https://nappe-worker.tu-usuario.workers.dev
export const WORKER_URL = 'https://YOUR-WORKER.workers.dev';
