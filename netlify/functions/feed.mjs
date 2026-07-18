import { callClaude, extractJson, jsonResponse } from './_lib.mjs';

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'metodo no permitido' }, 405);

  try {
    const body = await req.json();
    const taste = body.taste_profile || {};
    const recipes = Array.isArray(body.recipes) ? body.recipes : [];
    if (recipes.length === 0) return jsonResponse([]);

    const system = `Eres el motor de personalizacion de Nappe, una app de recetas.
Recibiras el perfil de gustos de un usuario y una lista de recetas.
Devuelve SOLAMENTE un array JSON de ids de receta (strings), ordenados
de mas a menos afines al perfil. No incluyas ningun otro texto, ninguna
explicacion, ningun bloque de codigo markdown. Solo el array JSON.
Incluye TODOS los ids recibidos, ninguno menos, ninguno de mas.`;

    const text = await callClaude({
      system,
      messages: [{ role: 'user', content: JSON.stringify({ perfil: taste, recetas: recipes }) }],
      maxTokens: 2000,
    });

    const parsed = extractJson(text);
    if (!Array.isArray(parsed)) return jsonResponse({ error: 'respuesta invalida del modelo' }, 502);

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: err.message || 'error interno' }, 500);
  }
};

export const config = { path: '/api/feed' };
