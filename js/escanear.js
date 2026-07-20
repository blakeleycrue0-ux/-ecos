import { supabase, requireAuth } from './supabase-client.js';
import { toast, compressImageToDataUrl, parseAiJson } from './utils.js';

const $ = (sel) => document.querySelector(sel);

let user = null;
let capturedDataUrl = null;

async function init() {
  user = await requireAuth();
  if (!user) return;

  $('#capture-box').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', onFileSelected);
  $('#analyze-btn').addEventListener('click', analyzePhoto);
  $('#manual-btn').addEventListener('click', () => showReview({ nombre: '', kcal: '', proteina: '', carbos: '', grasa: '' }, 'Añadir a mano'));
  $('#save-btn').addEventListener('click', saveMeal);
  $('#retry-btn').addEventListener('click', reset);
}

async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  capturedDataUrl = await compressImageToDataUrl(file);
  const preview = $('#capture-preview');
  preview.src = capturedDataUrl;
  preview.classList.remove('hidden');
  $('#capture-hint').classList.add('hidden');
  $('#analyze-btn').disabled = false;
}

async function analyzePhoto() {
  if (!capturedDataUrl) return;
  const btn = $('#analyze-btn');
  btn.disabled = true;
  btn.classList.add('hidden');
  $('#manual-btn').classList.add('hidden');
  $('#analyzing').classList.remove('hidden');

  try {
    const res = await fetch('/api/comida', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: capturedDataUrl }),
    });
    if (!res.ok) throw new Error('api/comida ' + res.status);
    const raw = await res.text();
    const parsed = parseAiJson(raw);
    if (!parsed || parsed.error || parsed.kcal == null) {
      throw new Error(parsed && parsed.error ? parsed.error : 'respuesta invalida');
    }
    showReview(parsed, 'Revisa y guarda');
  } catch (err) {
    toast('No se pudo analizar la foto. Rellena los datos a mano.');
    showReview({ nombre: '', kcal: '', proteina: '', carbos: '', grasa: '' }, 'Añadir a mano');
  } finally {
    $('#analyzing').classList.add('hidden');
    btn.classList.remove('hidden');
    $('#manual-btn').classList.remove('hidden');
    btn.disabled = false;
  }
}

function showReview(data, title) {
  $('#review-title').textContent = title;
  $('#f-nombre').value = data.nombre || '';
  $('#f-kcal').value = data.kcal ?? '';
  $('#f-proteina').value = data.proteina ?? '';
  $('#f-carbos').value = data.carbos ?? '';
  $('#f-grasa').value = data.grasa ?? '';
  $('#capture-step').classList.add('hidden');
  $('#review-step').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function reset() {
  capturedDataUrl = null;
  $('#file-input').value = '';
  $('#capture-preview').classList.add('hidden');
  $('#capture-hint').classList.remove('hidden');
  $('#analyze-btn').disabled = true;
  $('#review-step').classList.add('hidden');
  $('#capture-step').classList.remove('hidden');
}

function num(v) {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

async function saveMeal() {
  const nombre = $('#f-nombre').value.trim();
  if (!nombre) { toast('Ponle un nombre a la comida'); return; }
  const kcal = Math.round(num($('#f-kcal').value));
  if (!kcal) { toast('Faltan las calorias'); return; }

  const btn = $('#save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const { error } = await supabase.from('meals').insert({
    user_id: user.id,
    nombre,
    kcal,
    proteina: num($('#f-proteina').value),
    carbos: num($('#f-carbos').value),
    grasa: num($('#f-grasa').value),
  });

  btn.disabled = false;
  btn.textContent = 'Guardar comida';

  if (error) { toast('Error al guardar: ' + error.message); return; }
  window.location.href = 'app.html';
}

init();
