import { supabase, requireAuth, getProfile } from './supabase-client.js';
import { escapeHtml, dificultadLabel } from './utils.js';

const $ = (sel) => document.querySelector(sel);

const NIVEL_LABEL = { principiante: 'Principiante', medio: 'Medio', avanzado: 'Avanzado' };

let user = null;

async function init() {
  user = await requireAuth();
  if (!user) return;

  $('#tab-saves').addEventListener('click', () => showTab('saves'));
  $('#tab-cooked').addEventListener('click', () => showTab('cooked'));
  $('#logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  await Promise.all([loadSaves(), loadCooked(), loadProfile()]);
}

async function loadSaves() {
  const { data, error } = await supabase
    .from('saves')
    .select('recipe_id, created_at, recipes(id,titulo,imagen_url,minutos,dificultad)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const list = $('#saves-list');
  list.innerHTML = '';
  const rows = (error ? [] : data || []).filter((s) => s.recipes);
  $('#saves-empty').classList.toggle('hidden', rows.length > 0);

  for (const s of rows) {
    list.appendChild(buildRow(s.recipes, `${s.recipes.minutos ?? '?'} min · ${dificultadLabel(s.recipes.dificultad)}`));
  }
}

async function loadCooked() {
  const { data, error } = await supabase
    .from('cooked_log')
    .select('id, created_at, recipes(id,titulo,imagen_url,minutos,dificultad)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const list = $('#cooked-list');
  list.innerHTML = '';
  const rows = (error ? [] : data || []).filter((c) => c.recipes);
  $('#cooked-empty').classList.toggle('hidden', rows.length > 0);

  for (const c of rows) {
    const date = new Date(c.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    list.appendChild(buildRow(c.recipes, `Cocinada el ${date}`));
  }
}

function buildRow(recipe, subtitle) {
  const row = document.createElement('div');
  row.className = 'recipe-card-row';
  row.innerHTML = `
    <img src="${escapeHtml(recipe.imagen_url || '')}" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="info">
      <strong>${escapeHtml(recipe.titulo)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
  `;
  row.addEventListener('click', () => { window.location.href = `receta.html?id=${recipe.id}`; });
  return row;
}

async function loadProfile() {
  const [profile, { data: taste }] = await Promise.all([
    getProfile(user.id),
    supabase.from('taste_profile').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  $('#p-username').textContent = profile?.username || user.email || '-';
  if (taste) {
    $('#p-cocinas').textContent = (taste.cocinas || []).join(', ') || '-';
    $('#p-nivel').textContent = NIVEL_LABEL[taste.nivel] || '-';
    $('#p-tiempo').textContent = taste.tiempo_habitual ? `${taste.tiempo_habitual} min` : '-';
  }
}

function showTab(tab) {
  $('#tab-saves').classList.toggle('active', tab === 'saves');
  $('#tab-cooked').classList.toggle('active', tab === 'cooked');
  $('#saves-list').classList.toggle('hidden', tab !== 'saves');
  $('#saves-empty').classList.toggle('hidden', tab !== 'saves' || $('#saves-list').children.length > 0);
  $('#cooked-list').classList.toggle('hidden', tab !== 'cooked');
  $('#cooked-empty').classList.toggle('hidden', tab !== 'cooked' || $('#cooked-list').children.length > 0);
}

init();
