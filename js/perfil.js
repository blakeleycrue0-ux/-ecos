import { supabase, requireAuth } from './supabase-client.js';
import { toast } from './utils.js';

const $ = (sel) => document.querySelector(sel);

const OBJETIVO_LABEL = { perder: 'Perder grasa', mantener: 'Mantenerme', ganar: 'Ganar musculo' };

async function init() {
  const user = await requireAuth();
  if (!user) return;

  $('#logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [{ data: dp }, { data: meals, error: mErr }] = await Promise.all([
    supabase.from('diet_profile').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('meals').select('kcal,created_at').eq('user_id', user.id).gte('created_at', since.toISOString()),
  ]);

  if (mErr) toast('Error: ' + mErr.message);

  if (dp) {
    $('#p-objetivo').textContent = OBJETIVO_LABEL[dp.objetivo] || '-';
    $('#p-kcal').textContent = (dp.kcal_objetivo || '-') + ' kcal';
    $('#p-prot').textContent = (dp.proteina_objetivo || '-') + ' g';
    $('#p-carb').textContent = (dp.carbos_objetivo || '-') + ' g';
    $('#p-grasa').textContent = (dp.grasa_objetivo || '-') + ' g';
  }

  renderDays(meals || [], dp?.kcal_objetivo || null);
}

function renderDays(meals, objetivo) {
  const byDay = new Map();
  for (const m of meals) {
    const key = new Date(m.created_at).toDateString();
    byDay.set(key, (byDay.get(key) || 0) + (m.kcal || 0));
  }

  const list = $('#days-list');
  list.innerHTML = '';
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    if (!byDay.has(key) && i > 0) continue; // solo dias con registros (hoy siempre)
    rows.push({ date: d, kcal: byDay.get(key) || 0 });
  }

  $('#days-empty').classList.toggle('hidden', rows.length > 0);

  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'day-row' + (objetivo && r.kcal > objetivo ? ' over' : '');
    el.style.animationDelay = `${i * 0.05}s`;
    const label = i === 0 ? 'Hoy' : r.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });
    el.innerHTML = `
      <span class="d">${label}</span>
      <span class="k">${Math.round(r.kcal)} <small>/ ${objetivo || '-'} kcal</small></span>
    `;
    list.appendChild(el);
  });
}

init();
