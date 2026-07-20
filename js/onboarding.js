import { supabase, requireAuth } from './supabase-client.js';
import { toast, escapeHtml } from './utils.js';

const $ = (sel) => document.querySelector(sel);

const OBJETIVOS = [
  { v: 'perder', t: 'Perder grasa', d: 'Deficit suave, sin pasar hambre.' },
  { v: 'mantener', t: 'Mantenerme', d: 'Comer bien y quedarme como estoy.' },
  { v: 'ganar', t: 'Ganar musculo', d: 'Superavit ligero para construir.' },
];

const SEXOS = [
  { v: 'hombre', t: 'Hombre', d: '' },
  { v: 'mujer', t: 'Mujer', d: '' },
];

const ACTIVIDADES = [
  { v: 'sedentario', t: 'Sedentario', d: 'Trabajo de oficina, poco ejercicio.' },
  { v: 'ligero', t: 'Ligero', d: 'Camino bastante o entreno 1-2 dias.' },
  { v: 'moderado', t: 'Moderado', d: 'Entreno 3-5 dias por semana.' },
  { v: 'alto', t: 'Muy activo', d: 'Trabajo fisico o entreno casi a diario.' },
];

const MULT = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, alto: 1.725 };
const AJUSTE = { perder: -400, mantener: 0, ganar: 300 };

const state = {
  step: 1,
  objetivo: null,
  sexo: null,
  actividad: null,
  plan: null, // { kcal, prot, carb, grasa }
};

let user = null;
const TOTAL_STEPS = 5;

async function init() {
  user = await requireAuth();
  if (!user) return;

  renderSingleGrid('grid-objetivo', OBJETIVOS, (v) => state.objetivo = v);
  renderSingleGrid('grid-sexo', SEXOS, (v) => state.sexo = v);
  renderSingleGrid('grid-actividad', ACTIVIDADES, (v) => state.actividad = v);
  renderDots();

  $('#back-step').addEventListener('click', prevStep);
  $('#ob-form').addEventListener('submit', onSubmit);

  const { data: existing } = await supabase.from('diet_profile').select('*').eq('user_id', user.id).maybeSingle();
  if (existing) prefill(existing);
}

function prefill(p) {
  prefillSingle('grid-objetivo', OBJETIVOS, p.objetivo, (v) => state.objetivo = v);
  prefillSingle('grid-sexo', SEXOS, p.sexo, (v) => state.sexo = v);
  prefillSingle('grid-actividad', ACTIVIDADES, p.actividad, (v) => state.actividad = v);
  if (p.edad) $('#f-edad').value = p.edad;
  if (p.altura_cm) $('#f-altura').value = p.altura_cm;
  if (p.peso_kg) $('#f-peso').value = p.peso_kg;
}

function prefillSingle(gridId, options, value, onSelect) {
  if (value == null) return;
  const idx = options.findIndex((o) => o.v === value);
  if (idx === -1) return;
  const btn = $('#' + gridId).children[idx];
  if (btn) {
    btn.classList.add('selected');
    onSelect(value);
  }
}

function renderSingleGrid(gridId, options, onSelect) {
  const grid = $('#' + gridId);
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-card level-card wide';
    btn.innerHTML = `<span class="t">${escapeHtml(opt.t)}</span>${opt.d ? `<span class="d">${escapeHtml(opt.d)}</span>` : ''}`;
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

function getDatos() {
  return {
    edad: Number($('#f-edad').value),
    altura: Number($('#f-altura').value),
    peso: Number($('#f-peso').value),
  };
}

function validateStep() {
  if (state.step === 1 && !state.objetivo) { toast('Elige tu objetivo'); return false; }
  if (state.step === 2 && !state.sexo) { toast('Elige una opcion'); return false; }
  if (state.step === 3) {
    const { edad, altura, peso } = getDatos();
    if (!edad || !altura || !peso) { toast('Rellena edad, altura y peso'); return false; }
  }
  if (state.step === 4 && !state.actividad) { toast('Elige tu nivel de actividad'); return false; }
  return true;
}

// Mifflin-St Jeor + multiplicador de actividad + ajuste segun objetivo.
function calcularPlan() {
  const { edad, altura, peso } = getDatos();
  const tmb = 10 * peso + 6.25 * altura - 5 * edad + (state.sexo === 'hombre' ? 5 : -161);
  const kcal = Math.max(1200, Math.round((tmb * MULT[state.actividad] + AJUSTE[state.objetivo]) / 10) * 10);
  const prot = Math.round((kcal * 0.30) / 4);
  const carb = Math.round((kcal * 0.40) / 4);
  const grasa = Math.round((kcal * 0.30) / 9);
  return { kcal, prot, carb, grasa };
}

async function onSubmit(e) {
  e.preventDefault();
  if (!validateStep()) return;

  if (state.step < TOTAL_STEPS) {
    state.step += 1;
    if (state.step === TOTAL_STEPS) {
      state.plan = calcularPlan();
      $('#r-kcal').textContent = state.plan.kcal;
      $('#r-prot').textContent = state.plan.prot + 'g';
      $('#r-carb').textContent = state.plan.carb + 'g';
      $('#r-grasa').textContent = state.plan.grasa + 'g';
    }
    showStep(state.step);
    return;
  }

  await finish();
}

async function finish() {
  const btn = $('#next-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const { edad, altura, peso } = getDatos();
  const payload = {
    user_id: user.id,
    objetivo: state.objetivo,
    sexo: state.sexo,
    edad,
    altura_cm: altura,
    peso_kg: peso,
    actividad: state.actividad,
    kcal_objetivo: state.plan.kcal,
    proteina_objetivo: state.plan.prot,
    carbos_objetivo: state.plan.carb,
    grasa_objetivo: state.plan.grasa,
    updated_at: new Date().toISOString(),
  };

  const { error: dpErr } = await supabase.from('diet_profile').upsert(payload);
  if (dpErr) {
    toast('Error al guardar tu plan: ' + dpErr.message);
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }

  const { error: profErr } = await supabase.from('profiles').upsert({ id: user.id, onboarding_done: true });
  if (profErr) {
    toast('Error: ' + profErr.message);
    btn.disabled = false;
    btn.textContent = 'Empezar';
    return;
  }

  window.location.href = 'app.html';
}

init();
