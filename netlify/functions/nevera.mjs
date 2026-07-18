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

    const system = `Analizas fotos de neveras o despensas para Nappe, una app de
recetas. Devuelve SOLAMENTE JSON puro con esta forma exacta:
{"ingredientes": ["ingrediente1", "ingrediente2", ...]}
Usa nombres de ingredientes genericos y en minusculas, en español.
No incluyas marcas, cantidades ni texto adicional. No uses bloques de
codigo markdown. Solo el objeto JSON.`;

    const text = await callClaude({
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
      return jsonResponse({ error: 'respuesta invalida del modelo' }, 502);
    }

    return jsonResponse(parsed);
  } catch (err) {
    return jsonResponse({ error: err.message || 'error interno' }, 500);
  }
};

export const config = { path: '/api/nevera' };
