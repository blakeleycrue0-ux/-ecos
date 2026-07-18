// Nappe — Cloudflare Worker
// Proxy hacia la API de Anthropic. La API key vive solo aqui
// (env.ANTHROPIC_API_KEY, configurada con `wrangler secret put`).
// Rutas: POST /feed, POST /nevera, POST /parse
// Todas piden a Claude JSON puro, sin texto alrededor ni bloques de codigo.

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const headers = { Vary: 'Origin' };
  if (allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return headers;
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

async function callClaude(env, { system, messages, maxTokens = 1500 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

// Extrae JSON de una respuesta que deberia ser JSON puro pero puede
// venir envuelta en un bloque de codigo o con texto alrededor.
function extractJson(text) {
  if (!text) return null;
  let cleaned = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  cleaned = cleaned.slice(start);
  try {
    return JSON.parse(cleaned);
  } catch {
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (lastBrace === -1) return null;
    try {
      return JSON.parse(cleaned.slice(0, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

// ---------- /feed ----------

async function handleFeed(request, env) {
  const body = await request.json();
  const taste = body.taste_profile || {};
  const recipes = Array.isArray(body.recipes) ? body.recipes : [];

  if (recipes.length === 0) return json([], 200, request, env);

  const system = `Eres el motor de personalizacion de Nappe, una app de recetas.
Recibiras el perfil de gustos de un usuario y una lista de recetas.
Devuelve SOLAMENTE un array JSON de ids de receta (strings), ordenados
de mas a menos afines al perfil. No incluyas ningun otro texto, ninguna
explicacion, ningun bloque de codigo markdown. Solo el array JSON.
Incluye TODOS los ids recibidos, ninguno menos, ninguno de mas.`;

  const userContent = JSON.stringify({
    perfil: taste,
    recetas: recipes,
  });

  const text = await callClaude(env, {
    system,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 2000,
  });

  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) {
    return json({ error: 'respuesta invalida del modelo' }, 502, request, env);
  }

  return json(parsed, 200, request, env);
}

// ---------- /nevera ----------

async function handleNevera(request, env) {
  const body = await request.json();
  const image = body.image; // data URL: "data:image/jpeg;base64,...."
  if (!image || typeof image !== 'string' || !image.startsWith('data:')) {
    return json({ error: 'falta la imagen' }, 400, request, env);
  }

  const match = image.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return json({ error: 'formato de imagen invalido' }, 400, request, env);
  const [, mediaType, base64Data] = match;

  const system = `Analizas fotos de neveras o despensas para Nappe, una app de
recetas. Devuelve SOLAMENTE JSON puro con esta forma exacta:
{"ingredientes": ["ingrediente1", "ingrediente2", ...]}
Usa nombres de ingredientes genericos y en minusculas, en español.
No incluyas marcas, cantidades ni texto adicional. No uses bloques de
codigo markdown. Solo el objeto JSON.`;

  const text = await callClaude(env, {
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: 'Identifica los ingredientes visibles en esta imagen.' },
        ],
      },
    ],
    maxTokens: 1024,
  });

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.ingredientes)) {
    return json({ error: 'respuesta invalida del modelo' }, 502, request, env);
  }

  return json(parsed, 200, request, env);
}

// ---------- /parse ----------

async function handleParse(request, env) {
  const body = await request.json();
  const text = body.text;
  if (!text || typeof text !== 'string') {
    return json({ error: 'falta el texto de la receta' }, 400, request, env);
  }

  const system = `Estructuras recetas en bruto para el panel de admin de Nappe.
Devuelve SOLAMENTE JSON puro con esta forma exacta (usa null si no puedes
estimar un campo numerico, y [] si no hay elementos):
{
  "titulo": "string",
  "descripcion": "string breve",
  "minutos": number,
  "dificultad": "facil" | "media" | "dificil",
  "raciones": number,
  "cocina": "string",
  "tags": ["string", ...],
  "ingredientes": [{"nombre": "string", "cantidad": number|null, "unidad": "string|null"}],
  "pasos": [{"texto": "string", "minutos_timer": number|null}],
  "macros": {"kcal": number|null, "proteina": number|null, "carbos": number|null, "grasa": number|null}
}
Los macros son una estimacion por racion. No incluyas texto fuera del
JSON ni bloques de codigo markdown.`;

  const responseText = await callClaude(env, {
    system,
    messages: [{ role: 'user', content: text }],
    maxTokens: 2500,
  });

  const parsed = extractJson(responseText);
  if (!parsed) {
    return json({ error: 'respuesta invalida del modelo' }, 502, request, env);
  }

  return json(parsed, 200, request, env);
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'metodo no permitido' }, 405, request, env);
    }

    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/feed':
          return await handleFeed(request, env);
        case '/nevera':
          return await handleNevera(request, env);
        case '/parse':
          return await handleParse(request, env);
        default:
          return json({ error: 'ruta no encontrada' }, 404, request, env);
      }
    } catch (err) {
      return json({ error: err.message || 'error interno' }, 500, request, env);
    }
  },
};
