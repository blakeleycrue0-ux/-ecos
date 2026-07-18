import { supabase, requireAuth } from './supabase-client.js';
import { toast, escapeHtml } from './utils.js';

const $ = (sel) => document.querySelector(sel);

const COCINAS = ['Italiana', 'Española', 'Mexicana', 'Asiatica', 'India', 'Mediterranea', 'Francesa', 'Americana', 'Japonesa', 'Peruana', 'Marroqui', 'Nordica'];
const FAVORITOS = ['Pollo', 'Ternera', 'Cerdo', 'Pescado', 'Marisco', 'Huevos', 'Queso', 'Setas', 'Tomate', 'Aguacate', 'Legumbres', 'Pasta', 'Arroz', 'Chocolate'];
const ODIADOS = ['Cilantro', 'Picante', 'Marisco', 'Higado', 'Aceitunas', 'Cebolla', 'Ajo', 'Gluten', 'Lactosa', 'Frutos secos', 'Huevo', 'Setas'];

const NIVELES = [
  { v: 'principiante', t: 'Principiante', d: 'Sigo la receta al pie de la letra.' },
  { v: 'medio', t: 'Medio', d: 'Me manejo bien, improviso un poco.' },
  { v: 'avanzado', t: 'Avanzado', d: 'Domino tecnicas y me atrevo con todo.' },
];

const TIEMPOS = [
  { v: 15, t: 'Menos de 15 min', d: 'Necesito algo rapido.' },
  { v: 30, t: '15 a 40 min', d: 'Tengo un rato para cocinar.' },
  { v: 60, t: 'Mas de 40 min', d: 'Me gusta tomarme mi tiempo.' },
];

const state = {
  step: 1,
  cocinas: new Set(),
  favoritos: new Set(),
  odiados: new Set(),
  nivel: null,
  tiempo: null,
};

let user = null;
const TOTAL_STEPS = 5;

async function init() {
  user = await requireAuth();
  if (!user) return;

  renderChoiceGrid('grid-cocinas', COCINAS, state.cocinas);
  renderChoiceGrid('grid-favoritos', FAVORITOS, state.favoritos);
  renderChoiceGrid('grid-odiados', ODIADOS, state.odiados);
  renderSingleGrid('grid-nivel', NIVELES, (v) => state.nivel = v);
  renderSingleGrid('grid-tiempo', TIEMPOS, (v) => state.tiempo = v);
  renderDots();

  $('#fav-add').addEventListener('click', () => addFree('fav-input', 'grid-favoritos', state.favoritos));
  $('#hate-add').addEventListener('click', () => addFree('hate-input', 'grid-odiados', state.odiados));
  $('#back-step').addEventListener('click', prevStep);
  $('#ob-form').addEventListener('submit', onSubmit);

  const { data: existing } = await supabase.from('taste_profile').select('*').eq('user_id', user.id).maybeSingle();
  if (existing) prefillFromExisting(existing);
}

function prefillFromExisting(existing) {
  prefillMulti('grid-cocinas', existing.cocinas, state.cocinas);
  prefillMulti('grid-favoritos', existing.ingredientes_favoritos, state.favoritos);
  prefillMulti('grid-odiados', existing.ingredientes_odiados, state.odiados);
  prefillSingle('grid-nivel', NIVELES, existing.nivel, (v) => state.nivel = v);
  prefillSingle('grid-tiempo', TIEMPOS, existing.tiempo_habitual, (v) => state.tiempo = v);
}

function prefillMulti(gridId, values, set) {
  if (!Array.isArray(values) || values.length === 0) return;
  const grid = $('#' + gridId);
  for (const val of values) {
    const existingBtn = [...grid.querySelectorAll('.choice-card')].find((b) => b.textContent.toLowerCase() === val.toLowerCase());
    if (existingBtn) {
      set.add(existingBtn.textContent);
      existingBtn.classList.add('selected');
    } else {
      addChoiceCard(grid, val, set);
      set.add(val);
      grid.lastElementChild.classList.add('selected');
    }
  }
}

function prefillSingle(gridId, options, value, onSelect) {
  if (value == null) return;
  const idx = options.findIndex((o) => o.v === value);
  if (idx === -1) return;
  const grid = $('#' + gridId);
  const btn = grid.children[idx];
  if (btn) {
    btn.classList.add('selected');
    onSelect(value);
  }
}

function renderChoiceGrid(gridId, options, set) {
  const grid = $('#' + gridId);
  for (const opt of options) addChoiceCard(grid, opt, set);
}

function addChoiceCard(grid, label, set) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'choice-card';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (set.has(label)) { set.delete(label); btn.classList.remove('selected'); }
    else { set.add(label); btn.classList.add('selected'); }
  });
  grid.appendChild(btn);
}

function addFree(inputId, gridId, set) {
  const input = $('#' + inputId);
  const val = input.value.trim();
  if (!val) return;
  const grid = $('#' + gridId);
  const existing = [...grid.querySelectorAll('.choice-card')].find((b) => b.textContent.toLowerCase() === val.toLowerCase());
  if (existing) {
    if (!set.has(existing.textContent)) { set.add(existing.textContent); existing.classList.add('selected'); }
  } else {
    addChoiceCard(grid, val, set);
    set.add(val);
    grid.lastElementChild.classList.add('selected');
  }
  input.value = '';
}

function renderSingleGrid(gridId, options, onSelect) {
  const grid = $('#' + gridId);
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-card level-card wide';
    btn.innerHTML = `<span class="t">${escapeHtml(opt.t)}</span><span class="d">${escapeHtml(opt.d)}</span>`;
    btn.addEventListener('click', () => {
      [...grid.children].forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      onSelect(opt.v);
    });
    grid.appendChild(btn);
  }
}

function renderDots() {
  const wrap = $('#progress-dots');
  wrap.innerHTML = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const s = document.createElement('span');
    if (i <= state.step) s.classList.add('done');
    wrap.appendChild(s);
  }
  $('#back-step').style.visibility = state.step === 1 ? 'hidden' : 'visible';
}

function showStep(n) {
  document.querySelectorAll('.ob-step').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === n);
  });
  $('#next-btn').textContent = n === TOTAL_STEPS ? 'Empezar' : 'Siguiente';
  renderDots();
  window.scrollTo(0, 0);
}

function prevStep() {
  if (state.step === 1) return;
  state.step -= 1;
  showStep(state.step);
}

function validateStep() {
  if (state.step === 1 && state.cocinas.size === 0) { toast('Elige al menos una cocina'); return false; }
  if (state.step === 2 && state.favoritos.size === 0) { toast('Elige al menos un ingrediente'); return false; }
  if (state.step === 4 && !state.nivel) { toast('Elige tu nivel'); return false; }
  if (state.step === 5 && !state.tiempo) { toast('Elige cuanto tiempo sueles tener'); return false; }
  return true;
}

async function onSubmit(e) {
  e.preventDefault();
  if (!validateStep()) return;

  if (state.step < TOTAL_STEPS) {
    state.step += 1;
    showStep(state.step);
    return;
  }

  await finish();
}

async function finish() {
  const btn = $('#next-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const payload = {
    user_id: user.id,
    cocinas: [...state.cocinas],
    ingredientes_favoritos: [...state.favoritos],
    ingredientes_odiados: [...state.odiados],
    restricciones: [],
    nivel: state.nivel,
    tiempo_habitual: state.tiempo,
    updated_at: new Date().toISOString(),
  };

  const { error: tpErr } = await supabase.from('taste_profile').upsert(payload);
  if (tpErr) {
    toast('Error al guardar tus gustos: ' + tpErr.message);
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }

  const { error: profErr } = await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id);
  if (profErr) {
    toast('Error: ' + profErr.message);
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }

  window.location.href = 'app.html';
}

init();
