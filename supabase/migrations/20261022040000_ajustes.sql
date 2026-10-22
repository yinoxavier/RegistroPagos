-- Ajustes del sistema. Solo la función (clave secreta) lee todo;
-- los usuarios con sesión solo ven el estado de la hoja de Drive.
create table if not exists public.ajustes (
  clave       text primary key,
  valor       text,
  actualizado timestamptz not null default now()
);

alter table public.ajustes enable row level security;

create policy "Usuarios con sesión ven el estado de Drive"
  on public.ajustes for select
  to authenticated
  using (clave in ('drive_hoja_url', 'drive_actualizado_en', 'drive_error'));

-- Clave compartida con el Apps Script de la hoja de Drive (se genera al azar)
insert into public.ajustes (clave, valor)
values ('drive_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (clave) do nothing;
