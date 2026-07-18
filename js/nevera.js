import { supabase, requireAuth } from './supabase-client.js';
import { toast, escapeHtml, compressImageToDataUrl, parseAiJson } from './utils.js';

const $ = (sel) => document.querySelector(sel);

let user = null;
let capturedDataUrl = null;
let ingredients = []; // array de strings

async function init() {
  user = await requireAuth();
  if (!user) return;

  $('#capture-box').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', onFileSelected);
  $('#analyze-btn').addEventListener('click', analyzePhoto);
  $('#add-ing-btn').addEventListener('click', addIngredientFromInput);
  $('#new-ing-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addIngredientFromInput(); }
  });
  $('#search-btn').addEventListener('click', searchRecipes);
  $('#retake-btn').addEventListener('click', resetToCapture);
  $('#back-to-edit-btn').addEventListener('click', () => showStep('edit'));
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
  $('#analyze-status').textContent = 'Analizando...';

  try {
    const res = await fetch('/api/nevera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: capturedDataUrl }),
    });
    if (!res.ok) throw new Error('api/nevera ' + res.status);
    const raw = await res.text();
    const parsed = parseAiJson(raw);
    if (!parsed || !Array.isArray(parsed.ingredientes)) throw new Error('respuesta invalida');

    ingredients = parsed.ingredientes.map((i) => String(i).trim()).filter(Boolean);
    $('#analyze-status').textContent = '';
  } catch (err) {
    ingredients = [];
    toast('No se pudo analizar la foto. Añade los ingredientes a mano.');
    $('#analyze-status').textContent = 'Analisis no disponible ahora mismo.';
  }

  btn.disabled = false;
  renderChips();
  showStep('edit');
}

function renderChips() {
  const list = $('#chip-list');
  list.innerHTML = '';
  ingredients.forEach((ing, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(ing)} <button type="button" aria-label="Quitar">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      ingredients.splice(idx, 1);
      renderChips();
    });
    list.appendChild(chip);
  });
}

function addIngredientFromInput() {
  const input = $('#new-ing-input');
  const val = input.value.trim();
  if (!val) return;
  if (!ingredients.some((i) => i.toLowerCase() === val.toLowerCase())) {
    ingredients.push(val);
    renderChips();
  }
  input.value = '';
}

async function searchRecipes() {
  if (ingredients.length === 0) { toast('Añade al menos un ingrediente'); return; }

  const btn = $('#search-btn');
  btn.disabled = true;
  btn.textContent = 'Buscando...';

  const [{ data: recipes }, { data: allIngredients }] = await Promise.all([
    supabase.from('recipes').select('id,titulo,imagen_url,minutos,dificultad').eq('publicada', true),
    supabase.from('recipe_ingredients').select('recipe_id,nombre'),
  ]);

  btn.disabled = false;
  btn.textContent = 'Buscar recetas';

  const have = new Set(ingredients.map((i) => normalize(i)));
  const byRecipe = new Map();
  for (const ing of allIngredients || []) {
    if (!byRecipe.has(ing.recipe_id)) byRecipe.set(ing.recipe_id, []);
    byRecipe.get(ing.recipe_id).push(ing.nombre);
  }

  const results = (recipes || [])
    .map((r) => {
      const recipeIngs = byRecipe.get(r.id) || [];
      if (recipeIngs.length === 0) return null;
      const matched = recipeIngs.filter((n) => matchesAny(n, have));
      const missing = recipeIngs.filter((n) => !matchesAny(n, have));
      const pct = Math.round((matched.length / recipeIngs.length) * 100);
      return { recipe: r, pct, missing };
    })
    .filter((r) => r && r.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  renderResults(results);
  showStep('results');
}

function normalize(s) {
  return String(s).toLowerCase().trim();
}

function matchesAny(ingredientName, haveSet) {
  const n = normalize(ingredientName);
  for (const h of haveSet) {
    if (n.includes(h) || h.includes(n)) return true;
  }
  return false;
}

function renderResults(results) {
  const list = $('#results-list');
  list.innerHTML = '';
  $('#results-empty').classList.toggle('hidden', results.length > 0);

  for (const { recipe, pct, missing } of results) {
    const row = document.createElement('div');
    row.className = 'match-row';
    row.innerHTML = `
      <img src="${escapeHtml(recipe.imagen_url || '')}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="info">
        <strong>${escapeHtml(recipe.titulo)}</strong>
        <span style="font-size:0.8rem; color:var(--fg-faint);">${recipe.minutos ?? '?'} min</span>
        ${missing.length ? `<div class="missing">Te falta: ${escapeHtml(missing.slice(0, 4).join(', '))}${missing.length > 4 ? '...' : ''}</div>` : '<div class="missing">Lo tienes todo</div>'}
      </div>
      <span class="match-pct">${pct}%</span>
    `;
    row.addEventListener('click', () => { window.location.href = `receta.html?id=${recipe.id}`; });
    list.appendChild(row);
  }
}

function resetToCapture() {
  capturedDataUrl = null;
  ingredients = [];
  $('#capture-preview').classList.add('hidden');
  $('#capture-hint').classList.remove('hidden');
  $('#analyze-btn').disabled = true;
  $('#file-input').value = '';
  showStep('capture');
}

function showStep(step) {
  $('#capture-step').classList.toggle('hidden', step !== 'capture');
  $('#edit-step').classList.toggle('hidden', step !== 'edit');
  $('#results-step').classList.toggle('hidden', step !== 'results');
  window.scrollTo(0, 0);
}

init();
