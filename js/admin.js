import { supabase, requireAdmin } from './supabase-client.js';
import { toast, escapeHtml, dificultadLabel, parseAiJson } from './utils.js';

let recipes = [];
let currentId = null; // uuid de la receta en edicion (generado en cliente para nuevas)
let ingRows = [];  // { id, nombre, cantidad, unidad }
let stepRows = []; // { id, texto, minutos_timer, imagen_url }
let pendingImageUrl = null;

const $ = (sel) => document.querySelector(sel);

async function init() {
  const user = await requireAdmin();
  if (!user) return;

  $('#logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  $('#new-btn').addEventListener('click', () => openEditor(null));
  $('#back-btn').addEventListener('click', showList);
  $('#save-btn').addEventListener('click', saveRecipe);
  $('#delete-btn').addEventListener('click', deleteRecipe);
  $('#add-ing-btn').addEventListener('click', () => { addIngRow(); renderIng(); });
  $('#add-step-btn').addEventListener('click', () => { addStepRow(); renderSteps(); });
  $('#f-imagen-file').addEventListener('change', handleImageUpload);
  $('#ai-parse-btn').addEventListener('click', runAiParse);
  $('#search-input').addEventListener('input', renderList);
  $('#seed-btn').addEventListener('click', seedRecipes);

  await loadRecipes();
}

// Inserta las 100 recetas de ejemplo, saltando las que ya existan por titulo.
async function seedRecipes() {
  const btn = $('#seed-btn');
  const status = $('#seed-status');
  if (!confirm('Se van a cargar las recetas de ejemplo que falten. ¿Continuar?')) return;

  btn.disabled = true;
  status.textContent = 'Preparando recetas...';

  try {
    const { SEED_RECIPES } = await import('./seed-data.js');
    const existing = new Set(recipes.map((r) => (r.titulo || '').toLowerCase()));
    const pending = SEED_RECIPES.filter((r) => !existing.has(r.titulo.toLowerCase()));

    if (pending.length === 0) {
      status.textContent = 'Ya estan todas cargadas.';
      btn.disabled = false;
      return;
    }

    let done = 0;
    const BATCH = 20;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH).map((r) => ({ ...r, id: crypto.randomUUID() }));

      const { error: rErr } = await supabase.from('recipes').insert(batch.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        descripcion: r.descripcion,
        minutos: r.minutos,
        dificultad: r.dificultad,
        raciones: r.raciones,
        cocina: r.cocina,
        tags: r.tags,
        kcal: r.kcal,
        proteina: r.proteina,
        carbos: r.carbos,
        grasa: r.grasa,
        publicada: true,
      })));
      if (rErr) throw rErr;

      const ings = batch.flatMap((r) => r.ingredientes.map((ing, idx) => ({
        recipe_id: r.id, nombre: ing.nombre, cantidad: ing.cantidad, unidad: ing.unidad, orden: idx,
      })));
      const { error: iErr } = await supabase.from('recipe_ingredients').insert(ings);
      if (iErr) throw iErr;

      const steps = batch.flatMap((r) => r.pasos.map((p, idx) => ({
        recipe_id: r.id, orden: idx, texto: p.texto, minutos_timer: p.minutos_timer,
      })));
      const { error: sErr } = await supabase.from('recipe_steps').insert(steps);
      if (sErr) throw sErr;

      done += batch.length;
      status.textContent = `Cargadas ${done} de ${pending.length}...`;
    }

    status.textContent = `Listo: ${done} recetas cargadas y publicadas.`;
    toast('Recetas de ejemplo cargadas');
    await loadRecipes();
  } catch (err) {
    status.textContent = 'Error: ' + (err.message || err);
    toast('No se pudieron cargar: ' + (err.message || err));
  } finally {
    btn.disabled = false;
  }
}

async function loadRecipes() {
  const { data, error } = await supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { toast('Error cargando recetas: ' + error.message); return; }
  recipes = data || [];
  renderList();
}

function renderList() {
  const q = $('#search-input').value.trim().toLowerCase();
  const filtered = q
    ? recipes.filter((r) => (r.titulo || '').toLowerCase().includes(q) || (r.cocina || '').toLowerCase().includes(q))
    : recipes;

  const list = $('#recipe-list');
  list.innerHTML = '';
  $('#list-empty').classList.toggle('hidden', filtered.length > 0);

  for (const r of filtered) {
    const btn = document.createElement('button');
    btn.className = 'recipe-row';
    btn.innerHTML = `
      <img src="${escapeHtml(r.imagen_url || '')}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="info">
        <strong>${escapeHtml(r.titulo || 'Sin titulo')}</strong>
        <span>${escapeHtml(r.cocina || '')} &middot; ${r.minutos ?? '?'} min &middot; ${dificultadLabel(r.dificultad)}</span>
      </div>
      <span class="pill ${r.publicada ? 'pub' : 'draft'}">${r.publicada ? 'Publicada' : 'Borrador'}</span>
    `;
    btn.addEventListener('click', () => openEditor(r.id));
    list.appendChild(btn);
  }
}

function showList() {
  $('#editor-view').classList.add('hidden');
  $('#list-view').classList.remove('hidden');
  loadRecipes();
}

async function openEditor(id) {
  currentId = id || crypto.randomUUID();
  pendingImageUrl = null;
  ingRows = [];
  stepRows = [];

  if (id) {
    const recipe = recipes.find((r) => r.id === id);
    if (recipe) fillForm(recipe);

    const [{ data: ings }, { data: steps }] = await Promise.all([
      supabase.from('recipe_ingredients').select('*').eq('recipe_id', id).order('orden'),
      supabase.from('recipe_steps').select('*').eq('recipe_id', id).order('orden'),
    ]);
    ingRows = (ings || []).map((i) => ({ id: i.id, nombre: i.nombre, cantidad: i.cantidad, unidad: i.unidad }));
    stepRows = (steps || []).map((s) => ({ id: s.id, texto: s.texto, minutos_timer: s.minutos_timer, imagen_url: s.imagen_url }));
    $('#delete-btn').classList.remove('hidden');
  } else {
    clearForm();
    $('#delete-btn').classList.add('hidden');
  }

  if (ingRows.length === 0) addIngRow();
  if (stepRows.length === 0) addStepRow();
  renderIng();
  renderSteps();

  $('#ai-raw-text').value = '';
  $('#ai-status').textContent = '';
  $('#list-view').classList.add('hidden');
  $('#editor-view').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function clearForm() {
  $('#f-titulo').value = '';
  $('#f-descripcion').value = '';
  $('#f-video-url').value = '';
  $('#f-minutos').value = '';
  $('#f-dificultad').value = 'facil';
  $('#f-raciones').value = 4;
  $('#f-cocina').value = '';
  $('#f-tags').value = '';
  $('#f-kcal').value = '';
  $('#f-proteina').value = '';
  $('#f-carbos').value = '';
  $('#f-grasa').value = '';
  $('#f-publicada').checked = false;
  $('#img-preview').classList.add('hidden');
  $('#img-status').textContent = '';
}

function fillForm(r) {
  $('#f-titulo').value = r.titulo || '';
  $('#f-descripcion').value = r.descripcion || '';
  $('#f-video-url').value = r.video_url || '';
  $('#f-minutos').value = r.minutos ?? '';
  $('#f-dificultad').value = r.dificultad || 'facil';
  $('#f-raciones').value = r.raciones || 4;
  $('#f-cocina').value = r.cocina || '';
  $('#f-tags').value = (r.tags || []).join(', ');
  $('#f-kcal').value = r.kcal ?? '';
  $('#f-proteina').value = r.proteina ?? '';
  $('#f-carbos').value = r.carbos ?? '';
  $('#f-grasa').value = r.grasa ?? '';
  $('#f-publicada').checked = !!r.publicada;
  pendingImageUrl = r.imagen_url || null;
  if (pendingImageUrl) {
    $('#img-preview').src = pendingImageUrl;
    $('#img-preview').classList.remove('hidden');
  } else {
    $('#img-preview').classList.add('hidden');
  }
}

// ---------- ingredientes / pasos dinamicos ----------

function addIngRow(data = {}) {
  ingRows.push({ id: crypto.randomUUID(), nombre: data.nombre || '', cantidad: data.cantidad ?? '', unidad: data.unidad || '' });
}

function addStepRow(data = {}) {
  stepRows.push({ id: crypto.randomUUID(), texto: data.texto || '', minutos_timer: data.minutos_timer ?? '', imagen_url: data.imagen_url || null });
}

function renderIng() {
  const wrap = $('#ing-rows');
  wrap.innerHTML = '';
  ingRows.forEach((row, idx) => {
    const el = document.createElement('div');
    el.className = 'dyn-row';
    el.innerHTML = `
      <div class="grip">
        <button type="button" data-act="up" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" data-act="down" ${idx === ingRows.length - 1 ? 'disabled' : ''}>&darr;</button>
      </div>
      <div class="fields ing">
        <input type="text" data-f="nombre" placeholder="Ingrediente" value="${escapeHtml(row.nombre)}">
        <input type="text" data-f="cantidad" placeholder="Cant." value="${escapeHtml(row.cantidad)}">
        <input type="text" data-f="unidad" placeholder="Unidad" value="${escapeHtml(row.unidad)}">
      </div>
      <button type="button" class="rm">&times;</button>
    `;
    el.querySelector('[data-f="nombre"]').addEventListener('input', (e) => row.nombre = e.target.value);
    el.querySelector('[data-f="cantidad"]').addEventListener('input', (e) => row.cantidad = e.target.value);
    el.querySelector('[data-f="unidad"]').addEventListener('input', (e) => row.unidad = e.target.value);
    el.querySelector('.rm').addEventListener('click', () => { ingRows.splice(idx, 1); renderIng(); });
    const up = el.querySelector('[data-act="up"]');
    const down = el.querySelector('[data-act="down"]');
    if (up) up.addEventListener('click', () => { swap(ingRows, idx, idx - 1); renderIng(); });
    if (down) down.addEventListener('click', () => { swap(ingRows, idx, idx + 1); renderIng(); });
    wrap.appendChild(el);
  });
}

function renderSteps() {
  const wrap = $('#step-rows');
  wrap.innerHTML = '';
  stepRows.forEach((row, idx) => {
    const el = document.createElement('div');
    el.className = 'dyn-row';
    el.innerHTML = `
      <div class="grip">
        <button type="button" data-act="up" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" data-act="down" ${idx === stepRows.length - 1 ? 'disabled' : ''}>&darr;</button>
      </div>
      <div class="fields">
        <textarea data-f="texto" placeholder="Paso ${idx + 1}">${escapeHtml(row.texto)}</textarea>
        <input type="number" data-f="minutos_timer" placeholder="Minutos de temporizador (opcional)" value="${row.minutos_timer ?? ''}" min="0">
      </div>
      <button type="button" class="rm">&times;</button>
    `;
    el.querySelector('[data-f="texto"]').addEventListener('input', (e) => row.texto = e.target.value);
    el.querySelector('[data-f="minutos_timer"]').addEventListener('input', (e) => row.minutos_timer = e.target.value);
    el.querySelector('.rm').addEventListener('click', () => { stepRows.splice(idx, 1); renderSteps(); });
    const up = el.querySelector('[data-act="up"]');
    const down = el.querySelector('[data-act="down"]');
    if (up) up.addEventListener('click', () => { swap(stepRows, idx, idx - 1); renderSteps(); });
    if (down) down.addEventListener('click', () => { swap(stepRows, idx, idx + 1); renderSteps(); });
    wrap.appendChild(el);
  });
}

function swap(arr, i, j) {
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// ---------- imagen ----------

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  $('#img-status').textContent = 'Subiendo...';
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${currentId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('recipes').upload(path, file, { upsert: true });
  if (error) {
    $('#img-status').textContent = 'Error al subir: ' + error.message;
    return;
  }
  const { data } = supabase.storage.from('recipes').getPublicUrl(path);
  pendingImageUrl = data.publicUrl;
  $('#img-preview').src = pendingImageUrl;
  $('#img-preview').classList.remove('hidden');
  $('#img-status').textContent = 'Imagen subida.';
}

// ---------- guardar / eliminar ----------

function parseNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function saveRecipe() {
  const titulo = $('#f-titulo').value.trim();
  if (!titulo) { toast('Falta el titulo'); return; }

  const payload = {
    id: currentId,
    titulo,
    descripcion: $('#f-descripcion').value.trim() || null,
    imagen_url: pendingImageUrl,
    video_url: $('#f-video-url').value.trim() || null,
    minutos: parseNum($('#f-minutos').value),
    dificultad: $('#f-dificultad').value,
    raciones: parseNum($('#f-raciones').value) || 4,
    cocina: $('#f-cocina').value.trim() || null,
    tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    kcal: parseNum($('#f-kcal').value),
    proteina: parseNum($('#f-proteina').value),
    carbos: parseNum($('#f-carbos').value),
    grasa: parseNum($('#f-grasa').value),
    publicada: $('#f-publicada').checked,
  };

  const saveBtn = $('#save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  const { error: recipeErr } = await supabase.from('recipes').upsert(payload);
  if (recipeErr) {
    toast('Error al guardar: ' + recipeErr.message);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar receta';
    return;
  }

  await supabase.from('recipe_ingredients').delete().eq('recipe_id', currentId);
  const ingPayload = ingRows
    .filter((r) => r.nombre.trim())
    .map((r, idx) => ({
      recipe_id: currentId,
      nombre: r.nombre.trim(),
      cantidad: parseNum(r.cantidad),
      unidad: r.unidad.trim() || null,
      orden: idx,
    }));
  if (ingPayload.length) await supabase.from('recipe_ingredients').insert(ingPayload);

  await supabase.from('recipe_steps').delete().eq('recipe_id', currentId);
  const stepPayload = stepRows
    .filter((r) => r.texto.trim())
    .map((r, idx) => ({
      recipe_id: currentId,
      orden: idx,
      texto: r.texto.trim(),
      minutos_timer: parseNum(r.minutos_timer),
      imagen_url: r.imagen_url || null,
    }));
  if (stepPayload.length) await supabase.from('recipe_steps').insert(stepPayload);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Guardar receta';
  toast('Receta guardada');
  showList();
}

async function deleteRecipe() {
  if (!currentId) return;
  if (!confirm('¿Eliminar esta receta? Esta accion no se puede deshacer.')) return;
  const { error } = await supabase.from('recipes').delete().eq('id', currentId);
  if (error) { toast('Error al eliminar: ' + error.message); return; }
  toast('Receta eliminada');
  showList();
}

// ---------- autocompletar con IA ----------

async function runAiParse() {
  const text = $('#ai-raw-text').value.trim();
  if (!text) { toast('Pega el texto de la receta primero'); return; }

  const btn = $('#ai-parse-btn');
  btn.disabled = true;
  $('#ai-status').textContent = 'Analizando con IA...';

  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('api/parse respondio ' + res.status);
    const raw = await res.text();
    const parsed = parseAiJson(raw);
    if (!parsed) throw new Error('Respuesta de IA no valida');

    applyAiResult(parsed);
    $('#ai-status').textContent = 'Formulario rellenado. Revisalo antes de guardar.';
  } catch (err) {
    $('#ai-status').textContent = 'No se pudo autocompletar: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

function applyAiResult(data) {
  if (data.titulo) $('#f-titulo').value = data.titulo;
  if (data.descripcion) $('#f-descripcion').value = data.descripcion;
  if (data.minutos != null) $('#f-minutos').value = data.minutos;
  if (data.dificultad) $('#f-dificultad').value = data.dificultad;
  if (data.raciones != null) $('#f-raciones').value = data.raciones;
  if (data.cocina) $('#f-cocina').value = data.cocina;
  if (Array.isArray(data.tags)) $('#f-tags').value = data.tags.join(', ');

  const macros = data.macros || data;
  if (macros.kcal != null) $('#f-kcal').value = macros.kcal;
  if (macros.proteina != null) $('#f-proteina').value = macros.proteina;
  if (macros.carbos != null) $('#f-carbos').value = macros.carbos;
  if (macros.grasa != null) $('#f-grasa').value = macros.grasa;

  if (Array.isArray(data.ingredientes) && data.ingredientes.length) {
    ingRows = data.ingredientes.map((i) => ({
      id: crypto.randomUUID(),
      nombre: i.nombre || i.ingrediente || '',
      cantidad: i.cantidad ?? '',
      unidad: i.unidad ?? '',
    }));
    renderIng();
  }

  if (Array.isArray(data.pasos) && data.pasos.length) {
    stepRows = data.pasos.map((p) => ({
      id: crypto.randomUUID(),
      texto: typeof p === 'string' ? p : (p.texto || ''),
      minutos_timer: (typeof p === 'object' && p.minutos_timer) || '',
      imagen_url: null,
    }));
    renderSteps();
  }
}

init();
