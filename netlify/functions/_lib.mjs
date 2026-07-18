// Nappe — helpers compartidos por las Netlify Functions.
// La API key de Anthropic vive solo en process.env.ANTHROPIC_API_KEY
// (variable de entorno de Netlify), nunca en el cliente.

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

export async function callClaude({ system, messages, maxTokens = 1500 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
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
export function extractJson(text) {
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

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
