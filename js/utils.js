// Nappe — utilidades compartidas.

export function toast(msg, ms = 2600) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dificultadLabel(d) {
  return { facil: 'Facil', media: 'Media', dificil: 'Dificil' }[d] || d || '';
}

// Intenta parsear una respuesta de Claude que deberia ser JSON puro,
// pero puede venir envuelta en texto o en un bloque de codigo.
export function parseAiJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  cleaned = cleaned.slice(start);
  try {
    return JSON.parse(cleaned);
  } catch {
    // intenta recortar al ultimo cierre valido de array/objeto
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (lastBrace === -1) return null;
    try {
      return JSON.parse(cleaned.slice(0, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

// Comprime una imagen (File/Blob) a un data URL JPEG dentro de un limite
// de lado maximo, para mandarla en base64 sin pesar demasiado.
export function compressImageToDataUrl(file, maxSide = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSide) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else if (height > maxSide) {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
