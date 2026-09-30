-- App de gestión de clientes: administradoras, suscripciones, respuestas al buzón y mini asesoría.
-- Ejecútalo en Supabase (SQL Editor). Si aún no tienes la tabla comunidad (schema_comunidad.sql), la crea.
-- Se puede ejecutar más de una vez sin romper nada.
-- Al final da de alta como administradora a paularamisb@gmail.com (tiene que tener ya cuenta en la app).

-- ── Administradoras ──
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  email text,
  creado_en timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists admins_propia on public.admins;
create policy admins_propia on public.admins for select using (user_id = auth.uid());

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ── Suscripciones: premium (desde 1 €) o asesoria (premium + mini asesoría, desde 5 €) ──
create table if not exists public.suscripciones (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null check (plan in ('premium','asesoria')),
  activa boolean not null default true,
  hasta date,                -- vacío = sin fecha de fin
  importe numeric(10,2),     -- aportación al mes, solo como referencia
  nota text,
  actualizado_en timestamptz not null default now()
);
alter table public.suscripciones enable row level security;
drop policy if exists suscripciones_leer on public.suscripciones;
create policy suscripciones_leer on public.suscripciones for select using (user_id = auth.uid() or public.es_admin());
-- Solo se escribe con admin_set_suscripcion, que deja constancia en el historial.

create table if not exists public.suscripciones_historial (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  plan text, activa boolean, hasta date, importe numeric(10,2), nota text,
  hecho_por uuid references auth.users on delete set null,
  hecho_en timestamptz not null default now()
);
alter table public.suscripciones_historial enable row level security;
drop policy if exists suscripciones_historial_admin on public.suscripciones_historial;
create policy suscripciones_historial_admin on public.suscripciones_historial for select using (public.es_admin());

-- Premium activo por suscripción o por el sistema anterior (tabla perfiles de schema_premium.sql).
-- La función anterior se conserva como es_premium_perfiles; es_premium mantiene su identidad para
-- que las políticas que ya la usan tengan en cuenta también las suscripciones.
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'es_premium_perfiles') then
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'es_premium' and p.pronargs = 0) then
      execute replace(pg_get_functiondef('public.es_premium()'::regprocedure), 'public.es_premium()', 'public.es_premium_perfiles()');
    else
      execute 'create function public.es_premium_perfiles() returns boolean language sql stable as ''select false''';
    end if;
  end if;
end $$;

create or replace function public.tiene_suscripcion(p_plan text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.suscripciones s
                 where s.user_id = auth.uid() and s.activa
                   and (s.hasta is null or s.hasta >= current_date)
                   and (p_plan is null or s.plan = p_plan));
$$;

create or replace function public.es_premium() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.es_premium_perfiles(), false) or public.tiene_suscripcion();
$$;

create or replace function public.tiene_asesoria() returns boolean
language sql stable security definer set search_path = public as $$
  select public.tiene_suscripcion('asesoria');
$$;

-- Columna que identifica al usuario en perfiles (user_id o id), si esa tabla tiene "premium".
create or replace function public._perfiles_clave() returns text
language sql stable security definer set search_path = public as $$
  select k.column_name::text from information_schema.columns k
  where k.table_schema = 'public' and k.table_name = 'perfiles' and k.column_name in ('user_id','id')
    and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'perfiles' and c.column_name = 'premium')
  order by k.column_name = 'user_id' desc limit 1;
$$;

-- ── Buzón de la comunidad (pestaña Comunidad de la app): estado y respuesta ──
create table if not exists public.comunidad (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('supporter','idea','fallo')),
  texto text not null default '',
  importe numeric(10,2),
  info jsonb
);
alter table public.comunidad add column if not exists user_id uuid default auth.uid() references auth.users on delete cascade;
alter table public.comunidad add column if not exists estado text not null default 'nuevo';
alter table public.comunidad add column if not exists respuesta text;
alter table public.comunidad add column if not exists respondido_en timestamptz;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comunidad' and column_name in ('creado_en','created_at')) then
    alter table public.comunidad add column creado_en timestamptz not null default now();
  end if;
end $$;
alter table public.comunidad enable row level security;
drop policy if exists comunidad_propios_enviar on public.comunidad;
create policy comunidad_propios_enviar on public.comunidad for insert with check (user_id = auth.uid());
drop policy if exists comunidad_propios_leer on public.comunidad;
create policy comunidad_propios_leer on public.comunidad for select using (user_id = auth.uid());
drop policy if exists comunidad_admin on public.comunidad;
create policy comunidad_admin on public.comunidad for all using (public.es_admin()) with check (public.es_admin());

-- ── Mini asesoría: conversación entre cada cliente con plan asesoria y la administradora ──
create table if not exists public.asesoria_mensajes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  autor text not null check (autor in ('cliente','admin')),
  texto text not null check (length(texto) between 1 and 4000),
  leido boolean not null default false,  -- lo ha leído la otra parte
  creado_en timestamptz not null default now()
);
create index if not exists asesoria_mensajes_user on public.asesoria_mensajes (user_id, creado_en);
alter table public.asesoria_mensajes enable row level security;
drop policy if exists asesoria_leer on public.asesoria_mensajes;
create policy asesoria_leer on public.asesoria_mensajes for select using (user_id = auth.uid() or public.es_admin());
drop policy if exists asesoria_escribir on public.asesoria_mensajes;
create policy asesoria_escribir on public.asesoria_mensajes for insert with check (
  (user_id = auth.uid() and autor = 'cliente' and public.tiene_asesoria())
  or (public.es_admin() and autor = 'admin'));
drop policy if exists asesoria_admin_cambiar on public.asesoria_mensajes;
create policy asesoria_admin_cambiar on public.asesoria_mensajes for update using (public.es_admin()) with check (public.es_admin());
drop policy if exists asesoria_admin_borrar on public.asesoria_mensajes;
create policy asesoria_admin_borrar on public.asesoria_mensajes for delete using (public.es_admin());

-- Para que el chat de la app se actualice solo (Realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asesoria_mensajes') then
    alter publication supabase_realtime add table public.asesoria_mensajes;
  end if;
end $$;

-- El cliente marca como leídas las respuestas (sin poder tocar nada más).
create or replace function public.marcar_asesoria_leida() returns void
language sql security definer set search_path = public as $$
  update public.asesoria_mensajes set leido = true where user_id = auth.uid() and autor = 'admin' and not leido;
$$;

-- ── Funciones de la app de gestión (solo administradoras) ──
create or replace function public.admin_clientes()
returns table (user_id uuid, email text, nombre text, registrado timestamptz, ultimo_acceso timestamptz,
               plan text, activa boolean, hasta date, importe numeric, nota text, premium_antiguo boolean,
               asesoria_sin_leer int, buzon_pendiente int)
language plpgsql stable security definer set search_path = public as $$
declare clave text := public._perfiles_clave();
begin
  if not public.es_admin() then raise exception 'Solo para administradoras' using errcode = '42501'; end if;
  return query execute format($q$
    select u.id, u.email::text, (u.raw_user_meta_data->>'full_name')::text, u.created_at, u.last_sign_in_at,
           s.plan, s.activa, s.hasta, s.importe::numeric, s.nota, %s,
           (select count(*)::int from public.asesoria_mensajes m where m.user_id = u.id and m.autor = 'cliente' and not m.leido),
           (select count(*)::int from public.comunidad c where c.user_id = u.id and c.estado <> 'resuelto')
    from auth.users u left join public.suscripciones s on s.user_id = u.id
    order by u.created_at desc $q$,
    case when clave is null then 'false'
         else format('coalesce((select bool_or(p.premium) from public.perfiles p where p.%I = u.id), false)', clave) end);
end $$;

-- p_plan: 'premium', 'asesoria' o 'gratis' (quita el premium, también el del sistema anterior).
create or replace function public.admin_set_suscripcion(p_user uuid, p_plan text, p_hasta date default null,
                                                        p_importe numeric default null, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare clave text := public._perfiles_clave();
begin
  if not public.es_admin() then raise exception 'Solo para administradoras' using errcode = '42501'; end if;
  if p_plan = 'gratis' then
    update public.suscripciones set activa = false, actualizado_en = now() where user_id = p_user;
    if clave is not null then execute format('update public.perfiles set premium = false where %I = $1', clave) using p_user; end if;
  elsif p_plan in ('premium','asesoria') then
    insert into public.suscripciones (user_id, plan, activa, hasta, importe, nota, actualizado_en)
    values (p_user, p_plan, true, p_hasta, p_importe, p_nota, now())
    on conflict (user_id) do update set plan = excluded.plan, activa = true, hasta = excluded.hasta,
      importe = excluded.importe, nota = excluded.nota, actualizado_en = now();
  else
    raise exception 'Plan no válido: %', p_plan;
  end if;
  insert into public.suscripciones_historial (user_id, plan, activa, hasta, importe, nota, hecho_por)
  values (p_user, p_plan, p_plan <> 'gratis', p_hasta, p_importe, p_nota, auth.uid());
end $$;

-- Mensajes del buzón con el email de quien los envió.
create or replace function public.admin_buzon() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo para administradoras' using errcode = '42501'; end if;
  return query select to_jsonb(c) || jsonb_build_object('email', u.email, 'nombre', u.raw_user_meta_data->>'full_name')
    from public.comunidad c left join auth.users u on u.id = c.user_id;
end $$;

revoke execute on function public.admin_clientes(), public.admin_set_suscripcion(uuid, text, date, numeric, text), public.admin_buzon(), public._perfiles_clave() from public, anon;
grant execute on function public.admin_clientes(), public.admin_set_suscripcion(uuid, text, date, numeric, text), public.admin_buzon(),
  public.es_admin(), public.es_premium(), public.tiene_asesoria(), public.tiene_suscripcion(text), public.marcar_asesoria_leida() to authenticated;

-- ── Administradora ──
insert into public.admins (user_id, email)
select id, email from auth.users where lower(email) = 'paularamisb@gmail.com'
on conflict (user_id) do nothing;

-- Que la API de Supabase vea ya las funciones y tablas nuevas.
notify pgrst, 'reload schema';
