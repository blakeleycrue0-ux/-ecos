import { callClaude, extractJson, jsonResponse } from './_lib.mjs';

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'metodo no permitido' }, 405);

  try {
    const body = await req.json();
    const image = body.image;
    if (!image || typeof image !== 'string' || !image.startsWith('data:')) {
      return jsonResponse({ error: 'falta la imagen' }, 400);
    }

    const match = image.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match) return jsonResponse({ error: 'formato de imagen invalido' }, 400);
    const [, mediaType, base64Data] = match;

    const system = `Analizas fotos de platos de comida para Nappe, una app de
seguimiento nutricional. Estima la racion visible en la foto y devuelve
SOLAMENTE JSON puro con esta forma exacta:
{"nombre": "nombre corto del plato en español", "kcal": 000, "proteina": 00, "carbos": 00, "grasa": 00}
kcal es un entero; proteina, carbos y grasa son gramos (numeros, pueden
llevar un decimal). Se realista con el tamano de la racion que se ve.
Si la foto no es comida, devuelve {"error": "no es comida"}.
No uses bloques de codigo markdown. Solo el objeto JSON.`;

    const userText = body.hint
      ? `Analiza este plato. Pista del usuario: ${String(body.hint).slice(0, 200)}`
      : 'Analiza este plato.';

    const text = await callClaude({
      system,
      maxTokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });

    const parsed = extractJson(text);
    if (!parsed) return jsonResponse({ error: 'respuesta no valida' }, 502);
    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) }, 500);
  }
};

export const config = { path: '/api/comida' };
