import { callClaude, extractJson, jsonResponse } from './_lib.mjs';

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'metodo no permitido' }, 405);

  try {
    const body = await req.json();
    const text = body.text;
    if (!text || typeof text !== 'string') {
      return jsonResponse({ error: 'falta el texto de la receta' }, 400);
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

    const responseText = await callClaude({
      system,
      messages: [{ role: 'user', content: text }],
      maxTokens: 2500,
    });

    const parsed = extractJson(responseText);
    if (!parsed) return jsonResponse({ error: 'respuesta invalida del modelo' }, 502);

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: err.message || 'error interno' }, 500);
  }
};

export const config = { path: '/api/parse' };
