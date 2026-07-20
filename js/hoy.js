import { supabase, requireAuth, getProfile } from './supabase-client.js';
import { toast, escapeHtml } from './utils.js';

const $ = (sel) => document.querySelector(sel);
const RING_LEN = 326.7;

let user = null;
let plan = null;
let meals = [];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function setGreeting(profile) {
  const h = new Date().getHours();
  $('#greet-h').textContent = h < 13 ? 'Buenos dias' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  $('#greet-date').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
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

  const [{ data: dp }, { data: todayMeals, error: mErr }] = await Promise.all([
    supabase.from('diet_profile').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('meals').select('*').eq('user_id', user.id).gte('created_at', startOfToday()).order('created_at', { ascending: false }),
  ]);

  $('#loading-state').classList.add('hidden');

  if (!dp) {
    // cuenta antigua sin plan de dieta: al onboarding nuevo
    window.location.href = 'onboarding.html';
    return;
  }
  if (mErr) toast('Error cargando comidas: ' + mErr.message);

  plan = dp;
  meals = todayMeals || [];
  render();
}

function render() {
  const total = meals.reduce((a, m) => ({
    kcal: a.kcal + (m.kcal || 0),
    prot: a.prot + Number(m.proteina || 0),
    carb: a.carb + Number(m.carbos || 0),
    grasa: a.grasa + Number(m.grasa || 0),
  }), { kcal: 0, prot: 0, carb: 0, grasa: 0 });

  const objetivo = plan.kcal_objetivo || 2000;
  const left = objetivo - total.kcal;
  $('#kcal-left').textContent = Math.abs(Math.round(left));
  $('#kcal-left-lbl').textContent = left >= 0 ? 'kcal restantes' : 'kcal de mas';

  const frac = Math.max(0, Math.min(1, total.kcal / objetivo));
  $('#kcal-ring').style.strokeDashoffset = String(RING_LEN * (1 - frac));
  if (left < 0) $('#kcal-ring').style.stroke = 'var(--danger)';

  setMacro('prot', total.prot, plan.proteina_objetivo);
  setMacro('carb', total.carb, plan.carbos_objetivo);
  setMacro('grasa', total.grasa, plan.grasa_objetivo);

  renderMeals();
}

function setMacro(key, value, goal) {
  $('#m-' + key).textContent = `${Math.round(value)} / ${goal || '-'} g`;
  const frac = goal ? Math.min(1, value / goal) : 0;
  $('#b-' + key).style.width = (frac * 100) + '%';
}

function renderMeals() {
  const list = $('#meals-list');
  list.innerHTML = '';
  $('#meals-empty').classList.toggle('hidden', meals.length > 0);

  meals.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'meal-row';
    row.style.animationDelay = `${Math.min(i * 0.05, 0.3)}s`;
    const hora = new Date(m.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <div class="info">
        <strong>${escapeHtml(m.nombre)}</strong>
        <span>${hora} &middot; P ${Math.round(m.proteina)}g &middot; C ${Math.round(m.carbos)}g &middot; G ${Math.round(m.grasa)}g</span>
      </div>
      <span class="kcal">${m.kcal}</span>
      <button type="button" class="rm" aria-label="Borrar">&times;</button>
    `;
    row.querySelector('.rm').addEventListener('click', async () => {
      const { error } = await supabase.from('meals').delete().eq('id', m.id).eq('user_id', user.id);
      if (error) { toast('Error: ' + error.message); return; }
      meals = meals.filter((x) => x.id !== m.id);
      render();
    });
    list.appendChild(row);
  });
}

init();
