-- Nappe — pivot a app de dieta.
-- Ejecutar en el SQL Editor de Supabase DESPUES del schema.sql original.
-- Idempotente: se puede volver a ejecutar sin romper nada.
-- No borra las tablas antiguas de recetas (quedan sin uso).

-- Perfil de dieta: objetivo calorico y datos para calcularlo.
create table if not exists diet_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  objetivo text check (objetivo in ('perder', 'mantener', 'ganar')),
  sexo text check (sexo in ('hombre', 'mujer')),
  edad int,
  altura_cm int,
  peso_kg numeric,
  actividad text check (actividad in ('sedentario', 'ligero', 'moderado', 'alto')),
  kcal_objetivo int,
  proteina_objetivo int,
  carbos_objetivo int,
  grasa_objetivo int,
  updated_at timestamptz not null default now()
);

-- Comidas registradas (cada escaneo o entrada manual).
create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  kcal int not null default 0,
  proteina numeric not null default 0,
  carbos numeric not null default 0,
  grasa numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists meals_user_created_idx on meals(user_id, created_at desc);

alter table diet_profile enable row level security;
alter table meals enable row level security;

drop policy if exists "diet_profile_select_own" on diet_profile;
create policy "diet_profile_select_own" on diet_profile
  for select using (user_id = auth.uid());

drop policy if exists "diet_profile_insert_own" on diet_profile;
create policy "diet_profile_insert_own" on diet_profile
  for insert with check (user_id = auth.uid());

drop policy if exists "diet_profile_update_own" on diet_profile;
create policy "diet_profile_update_own" on diet_profile
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "meals_select_own" on meals;
create policy "meals_select_own" on meals
  for select using (user_id = auth.uid());

drop policy if exists "meals_insert_own" on meals;
create policy "meals_insert_own" on meals
  for insert with check (user_id = auth.uid());

drop policy if exists "meals_delete_own" on meals;
create policy "meals_delete_own" on meals
  for delete using (user_id = auth.uid());

-- Por si el schema original no se llego a aplicar del todo: asegura la
-- policy de insert en profiles (necesaria al terminar el onboarding).
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());
