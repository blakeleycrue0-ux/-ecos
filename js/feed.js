import { supabase, requireAuth, getProfile } from './supabase-client.js';
import { toast, escapeHtml, dificultadLabel, placeholderGradient } from './utils.js';

const $ = (sel) => document.querySelector(sel);
const feedEl = $('#feed');

let user = null;
let recipes = [];      // en el orden final mostrado
let savedIds = new Set();
let observer = null;
let loggedViews = new Set();

function setGreeting(profile) {
  const h = new Date().getHours();
  const greet = h < 13 ? 'Buenos dias' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  $('#greet-h').textContent = greet;
  const initial = (profile?.username || user.email || 'N').trim().charAt(0).toUpperCase();
  $('#avatar').textContent = initial;
}

async function init() {
  user = await requireAuth();
  if (!user) return;

  const profile = await getProfile(user.id);
  if (!profile || !profile.onboarding_done) {
    window.location.href = 'onboarding.html';
    return;
  }
  setGreeting(profile);

  const [{ data: allRecipes, error: rErr }, { data: taste }, { data: saves }] = await Promise.all([
    supabase.from('recipes').select('id,titulo,imagen_url,video_url,minutos,dificultad,raciones,cocina,tags,kcal').eq('publicada', true),
    supabase.from('taste_profile').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('saves').select('recipe_id').eq('user_id', user.id),
  ]);

  $('#loading-state').classList.add('hidden');

  if (rErr || !allRecipes || allRecipes.length === 0) {
    $('#empty-state').classList.remove('hidden');
    return;
  }

  savedIds = new Set((saves || []).map((s) => s.recipe_id));

  const orderedIds = await getOrderedIds(allRecipes, taste, user.id);
  const byId = new Map(allRecipes.map((r) => [r.id, r]));
  recipes = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // por si algun id del cache ya no existe, o hay recetas nuevas sin ordenar
  for (const r of allRecipes) if (!orderedIds.includes(r.id)) recipes.push(r);

  renderFeed();
}

// ---------- orden ----------

function tasteHash(taste) {
  if (!taste) return 'none';
  const norm = (arr) => (arr || []).map((s) => String(s).toLowerCase().trim()).sort().join(',');
  return [norm(taste.cocinas), norm(taste.ingredientes_favoritos), norm(taste.ingredientes_odiados), norm(taste.restricciones), taste.nivel, taste.tiempo_habitual].join('|');
}

async function getOrderedIds(recipesList, taste, userId) {
  const cacheKey = `nappe_feed_order_${userId}`;
  const hash = tasteHash(taste);
  const dayMs = 24 * 60 * 60 * 1000;

  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { cached = null; }

  if (cached && cached.hash === hash && Date.now() - cached.ts < dayMs && Array.isArray(cached.order)) {
    return cached.order;
  }

  let order = await fetchAiOrder(recipesList, taste).catch(() => null);
  if (!order || !Array.isArray(order) || order.length === 0) {
    order = localOrder(recipesList, taste).map((r) => r.id);
  }

  try { localStorage.setItem(cacheKey, JSON.stringify({ order, hash, ts: Date.now() })); } catch { /* storage llena, ignorar */ }
  return order;
}

async function fetchAiOrder(recipesList, taste) {
  const ids = recipesList.map((r) => r.id);
  const { data: ings } = await supabase
    .from('recipe_ingredients')
    .select('recipe_id,nombre,orden')
    .in('recipe_id', ids)
    .order('orden');

  const ingByRecipe = new Map();
  for (const i of ings || []) {
    if (!ingByRecipe.has(i.recipe_id)) ingByRecipe.set(i.recipe_id, []);
    const list = ingByRecipe.get(i.recipe_id);
    if (list.length < 5) list.push(i.nombre);
  }

  const payloadRecipes = recipesList.map((r) => ({
    id: r.id,
    titulo: r.titulo,
    tags: r.tags || [],
    cocina: r.cocina,
    ingredientes: ingByRecipe.get(r.id) || [],
    minutos: r.minutos,
    dificultad: r.dificultad,
  }));

  const res = await fetch('/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taste_profile: taste || {}, recipes: payloadRecipes }),
  });
  if (!res.ok) throw new Error('api/feed ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('formato invalido');
  return data;
}

function localOrder(recipesList, taste) {
  const norm = (s) => String(s || '').toLowerCase().trim();
  const cocinas = new Set((taste?.cocinas || []).map(norm));
  const favoritos = new Set((taste?.ingredientes_favoritos || []).map(norm));
  const odiados = new Set((taste?.ingredientes_odiados || []).map(norm));

  const dificultadPorNivel = { principiante: 'facil', medio: 'media', avanzado: 'dificil' };

  const scored = recipesList.map((r) => {
    let score = 0;
    const tags = (r.tags || []).map(norm);
    const cocina = norm(r.cocina);

    if (cocinas.has(cocina)) score += 4;
    for (const t of tags) {
      if (cocinas.has(t)) score += 3;
      if (favoritos.has(t)) score += 2;
      if (odiados.has(t)) score -= 6;
    }
    if (odiados.has(cocina)) score -= 3;

    if (taste?.nivel && r.dificultad === dificultadPorNivel[taste.nivel]) score += 1;
    if (taste?.tiempo_habitual && r.minutos && r.minutos <= taste.tiempo_habitual) score += 1;

    return { r, score, jitter: Math.random() };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.jitter - a.jitter));
  return scored.map((s) => s.r);
}

// ---------- render ----------

function renderFeed() {
  feedEl.innerHTML = '';
  observer = new IntersectionObserver(onIntersect, { threshold: 0.5 });

  recipes.forEach((r, i) => {
    const card = buildCard(r, i);
    feedEl.appendChild(card);
    observer.observe(card);
  });
}

function buildCard(r, i) {
  const card = document.createElement('div');
  card.className = 'recipe-card';
  card.dataset.id = r.id;
  card.style.animationDelay = `${Math.min(i * 0.05, 0.4)}s`;

  const ph = document.createElement('div');
  ph.className = 'ph';
  if (r.imagen_url) {
    const img = document.createElement('img');
    img.src = r.imagen_url;
    img.loading = 'lazy';
    img.alt = r.titulo;
    ph.appendChild(img);
  } else {
    ph.style.background = placeholderGradient(r.id);
  }
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = (r.tags || [])[0] || dificultadLabel(r.dificultad);
  ph.appendChild(tag);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'save-btn' + (savedIds.has(r.id) ? ' active' : '');
  saveBtn.innerHTML = '&#9733;';
  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSave(r.id, card); });
  ph.appendChild(saveBtn);

  card.appendChild(ph);

  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = `
    <h3>${escapeHtml(r.titulo)}</h3>
    <div class="meta-row" style="margin-top:8px;">
      <span>${r.minutos ?? '?'} min</span>
      <span>${dificultadLabel(r.dificultad)}</span>
      <span>${r.kcal ?? '?'} kcal</span>
    </div>
  `;
  card.appendChild(body);

  card.addEventListener('click', () => {
    window.location.href = `receta.html?id=${r.id}`;
  });

  return card;
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const id = entry.target.dataset.id;
      if (!loggedViews.has(id)) {
        loggedViews.add(id);
        logFeedEvent(id, 'vista');
      }
    }
  }
}

async function toggleSave(id, card) {
  const btn = card.querySelector('.save-btn');
  if (savedIds.has(id)) {
    const { error } = await supabase.from('saves').delete().eq('user_id', user.id).eq('recipe_id', id);
    if (error) { toast('Error: ' + error.message); return; }
    savedIds.delete(id);
    btn.classList.remove('active');
  } else {
    const { error } = await supabase.from('saves').insert({ user_id: user.id, recipe_id: id });
    if (error) { toast('Error: ' + error.message); return; }
    savedIds.add(id);
    btn.classList.add('active');
    logFeedEvent(id, 'guardada');
    toast('Guardada');
  }
}

async function logFeedEvent(recipeId, accion) {
  try {
    await supabase.from('feed_events').insert({ user_id: user.id, recipe_id: recipeId, accion });
  } catch { /* no bloquea la UI */ }
}

init();
