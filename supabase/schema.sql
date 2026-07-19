-- Nappe — esquema de base de datos y RLS
-- Ejecutar en el SQL Editor de Supabase, en un proyecto nuevo.
-- Idempotente: se puede volver a ejecutar sin romper nada.

create extension if not exists "pgcrypto";

-- =========================================================
-- TABLAS
-- =========================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  is_admin boolean not null default false,
  onboarding_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists taste_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cocinas text[] not null default '{}',
  ingredientes_favoritos text[] not null default '{}',
  ingredientes_odiados text[] not null default '{}',
  restricciones text[] not null default '{}',
  nivel text check (nivel in ('principiante', 'medio', 'avanzado')),
  tiempo_habitual int,
  updated_at timestamptz not null default now()
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text,
  imagen_url text,
  video_url text,
  minutos int,
  dificultad text check (dificultad in ('facil', 'media', 'dificil')),
  raciones int not null default 4,
  cocina text,
  tags text[] not null default '{}',
  kcal int,
  proteina numeric,
  carbos numeric,
  grasa numeric,
  publicada boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  nombre text not null,
  cantidad numeric,
  unidad text,
  orden int not null default 0
);

create table if not exists recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  orden int not null default 0,
  texto text not null,
  minutos_timer int,
  imagen_url text
);

create table if not exists saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists cooked_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists feed_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  accion text not null check (accion in ('vista', 'guardada', 'saltada')),
  created_at timestamptz not null default now()
);

create index if not exists recipe_ingredients_recipe_id_idx on recipe_ingredients(recipe_id);
create index if not exists recipe_steps_recipe_id_idx on recipe_steps(recipe_id);
create index if not exists feed_events_user_id_idx on feed_events(user_id);
create index if not exists recipes_publicada_idx on recipes(publicada);

-- =========================================================
-- HELPERS
-- =========================================================

-- security definer para evitar recursion de RLS al comprobar is_admin
-- dentro de las policies de otras tablas.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- crea automaticamente la fila de profiles al registrarse un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================
-- RLS
-- =========================================================

alter table profiles enable row level security;
alter table taste_profile enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_steps enable row level security;
alter table saves enable row level security;
alter table cooked_log enable row level security;
alter table feed_events enable row level security;

-- profiles: cada usuario lee/edita su propia fila. Los admins pueden leer todas
-- (necesario para que el panel admin no dependa de nada mas).
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- permite crear (upsert) la propia fila si por lo que sea no la creo el
-- trigger (p.ej. usuarios que existian antes de que la tabla existiera).
drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

-- taste_profile: solo su propio dueño
drop policy if exists "taste_profile_select_own" on taste_profile;
create policy "taste_profile_select_own" on taste_profile
  for select using (user_id = auth.uid());

drop policy if exists "taste_profile_insert_own" on taste_profile;
create policy "taste_profile_insert_own" on taste_profile
  for insert with check (user_id = auth.uid());

drop policy if exists "taste_profile_update_own" on taste_profile;
create policy "taste_profile_update_own" on taste_profile
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- recipes: cualquiera autenticado lee las publicadas; admin lee/escribe todo
drop policy if exists "recipes_select_published" on recipes;
create policy "recipes_select_published" on recipes
  for select using (publicada = true or is_admin());

drop policy if exists "recipes_admin_insert" on recipes;
create policy "recipes_admin_insert" on recipes
  for insert with check (is_admin());

drop policy if exists "recipes_admin_update" on recipes;
create policy "recipes_admin_update" on recipes
  for update using (is_admin()) with check (is_admin());

drop policy if exists "recipes_admin_delete" on recipes;
create policy "recipes_admin_delete" on recipes
  for delete using (is_admin());

-- recipe_ingredients: legibles si la receta es publicada o eres admin; solo admin escribe
drop policy if exists "recipe_ingredients_select" on recipe_ingredients;
create policy "recipe_ingredients_select" on recipe_ingredients
  for select using (
    is_admin() or exists (
      select 1 from recipes r where r.id = recipe_id and r.publicada = true
    )
  );

drop policy if exists "recipe_ingredients_admin_write" on recipe_ingredients;
create policy "recipe_ingredients_admin_write" on recipe_ingredients
  for insert with check (is_admin());

drop policy if exists "recipe_ingredients_admin_update" on recipe_ingredients;
create policy "recipe_ingredients_admin_update" on recipe_ingredients
  for update using (is_admin()) with check (is_admin());

drop policy if exists "recipe_ingredients_admin_delete" on recipe_ingredients;
create policy "recipe_ingredients_admin_delete" on recipe_ingredients
  for delete using (is_admin());

-- recipe_steps: mismo patron que recipe_ingredients
drop policy if exists "recipe_steps_select" on recipe_steps;
create policy "recipe_steps_select" on recipe_steps
  for select using (
    is_admin() or exists (
      select 1 from recipes r where r.id = recipe_id and r.publicada = true
    )
  );

drop policy if exists "recipe_steps_admin_write" on recipe_steps;
create policy "recipe_steps_admin_write" on recipe_steps
  for insert with check (is_admin());

drop policy if exists "recipe_steps_admin_update" on recipe_steps;
create policy "recipe_steps_admin_update" on recipe_steps
  for update using (is_admin()) with check (is_admin());

drop policy if exists "recipe_steps_admin_delete" on recipe_steps;
create policy "recipe_steps_admin_delete" on recipe_steps
  for delete using (is_admin());

-- saves: solo el propio usuario
drop policy if exists "saves_select_own" on saves;
create policy "saves_select_own" on saves
  for select using (user_id = auth.uid());

drop policy if exists "saves_insert_own" on saves;
create policy "saves_insert_own" on saves
  for insert with check (user_id = auth.uid());

drop policy if exists "saves_delete_own" on saves;
create policy "saves_delete_own" on saves
  for delete using (user_id = auth.uid());

-- cooked_log: solo el propio usuario
drop policy if exists "cooked_log_select_own" on cooked_log;
create policy "cooked_log_select_own" on cooked_log
  for select using (user_id = auth.uid());

drop policy if exists "cooked_log_insert_own" on cooked_log;
create policy "cooked_log_insert_own" on cooked_log
  for insert with check (user_id = auth.uid());

-- feed_events: solo el propio usuario (sin update/delete, es un log)
drop policy if exists "feed_events_select_own" on feed_events;
create policy "feed_events_select_own" on feed_events
  for select using (user_id = auth.uid());

drop policy if exists "feed_events_insert_own" on feed_events;
create policy "feed_events_insert_own" on feed_events
  for insert with check (user_id = auth.uid());

-- =========================================================
-- STORAGE (imagenes de recetas)
-- =========================================================

insert into storage.buckets (id, name, public)
values ('recipes', 'recipes', true)
on conflict (id) do nothing;

drop policy if exists "recipes_bucket_public_read" on storage.objects;
create policy "recipes_bucket_public_read" on storage.objects
  for select using (bucket_id = 'recipes');

drop policy if exists "recipes_bucket_admin_insert" on storage.objects;
create policy "recipes_bucket_admin_insert" on storage.objects
  for insert with check (bucket_id = 'recipes' and is_admin());

drop policy if exists "recipes_bucket_admin_update" on storage.objects;
create policy "recipes_bucket_admin_update" on storage.objects
  for update using (bucket_id = 'recipes' and is_admin());

drop policy if exists "recipes_bucket_admin_delete" on storage.objects;
create policy "recipes_bucket_admin_delete" on storage.objects
  for delete using (bucket_id = 'recipes' and is_admin());

-- =========================================================
-- PRIMER ADMIN
-- =========================================================
-- Despues de registrarte por primera vez en la app, ejecuta esto a mano
-- una sola vez, sustituyendo el email, para convertirte en admin:
--
-- update profiles set is_admin = true
-- where id = (select id from auth.users where email = 'tu@email.com');
