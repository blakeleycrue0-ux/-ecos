import { supabase, requireAuth } from './supabase-client.js';
import { toast, escapeHtml, dificultadLabel, placeholderGradient } from './utils.js';

const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(window.location.search);
const recipeId = params.get('id');

let user = null;
let recipe = null;
let ingredients = [];
let steps = [];
let baseRaciones = 4;
let currentRaciones = 4;
let isSaved = false;

let wakeLock = null;
let cookIndex = 0;
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;

async function init() {
  if (!recipeId) { window.location.href = 'app.html'; return; }
  user = await requireAuth();
  if (!user) return;

  $('#back-btn').addEventListener('click', () => history.length > 1 ? history.back() : (window.location.href = 'app.html'));
  $('#save-btn').addEventListener('click', toggleSave);
  $('#racion-minus').addEventListener('click', () => changeRaciones(-1));
  $('#racion-plus').addEventListener('click', () => changeRaciones(1));
  $('#cook-btn').addEventListener('click', startCookMode);
  $('#cook-close').addEventListener('click', exitCookMode);
  $('#cook-prev').addEventListener('click', () => goToStep(cookIndex - 1));
  $('#cook-next').addEventListener('click', () => goToStep(cookIndex + 1));
  $('#timer-toggle').addEventListener('click', toggleTimer);
  $('#timer-reset').addEventListener('click', resetTimer);

  await load();
  logFeedEvent('vista');
}

async function load() {
  const [{ data: r, error: rErr }, { data: ings }, { data: stps }, { data: save }] = await Promise.all([
    supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle(),
    supabase.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('orden'),
    supabase.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('orden'),
    supabase.from('saves').select('recipe_id').eq('recipe_id', recipeId).eq('user_id', user.id).maybeSingle(),
  ]);

  if (rErr || !r) { toast('No se pudo cargar la receta'); return; }

  recipe = r;
  ingredients = ings || [];
  steps = stps || [];
  isSaved = !!save;
  baseRaciones = recipe.raciones || 4;
  currentRaciones = baseRaciones;

  render();
}

function render() {
  document.title = `Nappe — ${recipe.titulo}`;
  $('#r-titulo').textContent = recipe.titulo;
  $('#r-descripcion').textContent = recipe.descripcion || '';
  $('#r-minutos').textContent = recipe.minutos ?? '-';
  $('#r-dificultad').textContent = dificultadLabel(recipe.dificultad) || '-';
  $('#r-cocina').textContent = recipe.cocina || '-';
  $('#r-kcal').textContent = recipe.kcal ?? '-';
  $('#r-proteina').textContent = recipe.proteina != null ? recipe.proteina + 'g' : '-';
  $('#r-carbos').textContent = recipe.carbos != null ? recipe.carbos + 'g' : '-';
  $('#r-grasa').textContent = recipe.grasa != null ? recipe.grasa + 'g' : '-';

  const media = $('#hero-media');
  media.innerHTML = '';
  if (recipe.video_url) {
    const v = document.createElement('video');
    v.src = recipe.video_url;
    v.controls = true;
    v.playsInline = true;
    v.poster = recipe.imagen_url || '';
    media.appendChild(v);
  } else if (recipe.imagen_url) {
    const img = document.createElement('img');
    img.src = recipe.imagen_url;
    img.alt = recipe.titulo;
    media.appendChild(img);
  } else {
    $('#hero').style.background = placeholderGradient(recipe.id);
  }

  updateSaveBtn();
  renderIngredients();
  renderCookSteps();
}

function updateSaveBtn() {
  $('#save-btn').classList.toggle('saved', isSaved);
}

function renderIngredients() {
  $('#racion-count').textContent = currentRaciones;
  const factor = currentRaciones / (baseRaciones || 1);
  const list = $('#ing-list');
  list.innerHTML = '';
  for (const ing of ingredients) {
    const li = document.createElement('li');
    const scaled = ing.cantidad != null ? roundNice(ing.cantidad * factor) : null;
    const amt = scaled != null ? `${scaled} ${ing.unidad || ''}`.trim() : (ing.unidad || '');
    li.innerHTML = `<span>${escapeHtml(ing.nombre)}</span><span class="amt">${escapeHtml(amt)}</span>`;
    list.appendChild(li);
  }
}

function roundNice(n) {
  const r = Math.round(n * 100) / 100;
  return r % 1 === 0 ? r : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function changeRaciones(delta) {
  const next = currentRaciones + delta;
  if (next < 1 || next > 30) return;
  currentRaciones = next;
  renderIngredients();
}

async function toggleSave() {
  if (isSaved) {
    const { error } = await supabase.from('saves').delete().eq('user_id', user.id).eq('recipe_id', recipeId);
    if (error) { toast('Error: ' + error.message); return; }
    isSaved = false;
  } else {
    const { error } = await supabase.from('saves').insert({ user_id: user.id, recipe_id: recipeId });
    if (error) { toast('Error: ' + error.message); return; }
    isSaved = true;
    logFeedEvent('guardada');
  }
  updateSaveBtn();
}

async function logFeedEvent(accion) {
  try {
    await supabase.from('feed_events').insert({ user_id: user.id, recipe_id: recipeId, accion });
  } catch { /* no bloquea la UI */ }
}

// ---------- modo cocina ----------

function renderCookSteps() {
  const dots = $('#cook-dots');
  dots.innerHTML = '';
  steps.forEach(() => {
    const s = document.createElement('span');
    dots.appendChild(s);
  });
}

async function startCookMode() {
  if (steps.length === 0) { toast('Esta receta no tiene pasos todavia'); return; }
  cookIndex = 0;
  $('#cook-mode').classList.remove('hidden');
  await requestWakeLock();
  goToStep(0);
}

function exitCookMode() {
  $('#cook-mode').classList.add('hidden');
  stopTimerInterval();
  releaseWakeLock();
}

function goToStep(idx) {
  if (idx < 0) return;
  stopTimerInterval();
  if (idx >= steps.length) {
    finishCooking();
    return;
  }
  cookIndex = idx;
  const step = steps[idx];
  $('#cook-step-num').textContent = `Paso ${idx + 1} de ${steps.length}`;
  $('#cook-step-text').textContent = step.texto;
  $('#cook-prev').disabled = idx === 0;
  $('#cook-next').textContent = idx === steps.length - 1 ? 'Terminar' : 'Siguiente';

  const dots = $('#cook-dots').children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('done', i <= idx);

  if (step.minutos_timer) {
    $('#cook-timer-wrap').classList.remove('hidden');
    timerSeconds = step.minutos_timer * 60;
    timerRunning = false;
    $('#timer-toggle').textContent = 'Iniciar';
    renderTimer();
  } else {
    $('#cook-timer-wrap').classList.add('hidden');
  }
}

async function finishCooking() {
  try {
    await supabase.from('cooked_log').insert({ user_id: user.id, recipe_id: recipeId });
  } catch { /* silencioso */ }
  toast('Buen provecho');
  exitCookMode();
}

function renderTimer() {
  const m = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(timerSeconds % 60).toString().padStart(2, '0');
  $('#cook-timer').textContent = `${m}:${s}`;
}

function toggleTimer() {
  timerRunning = !timerRunning;
  $('#timer-toggle').textContent = timerRunning ? 'Pausar' : 'Iniciar';
  if (timerRunning) {
    timerInterval = setInterval(() => {
      timerSeconds = Math.max(0, timerSeconds - 1);
      renderTimer();
      if (timerSeconds === 0) {
        stopTimerInterval();
        toast('Temporizador terminado');
      }
    }, 1000);
  } else {
    stopTimerInterval(false);
  }
}

function resetTimer() {
  stopTimerInterval();
  const step = steps[cookIndex];
  timerSeconds = (step.minutos_timer || 0) * 60;
  renderTimer();
  $('#timer-toggle').textContent = 'Iniciar';
}

function stopTimerInterval(resetRunning = true) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  if (resetRunning) timerRunning = false;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !$('#cook-mode').classList.contains('hidden') && !wakeLock) {
    await requestWakeLock();
  }
});

init();
