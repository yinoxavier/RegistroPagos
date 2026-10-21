-- Personas con una meta de aporte; cada pago se asigna a una persona.

create table if not exists public.personas (
  id             bigint generated always as identity primary key,
  nombre         text        not null check (char_length(nombre) between 2 and 120),
  correo         text        not null unique check (correo ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  meta_centavos  integer     not null default 5900 check (meta_centavos > 0),
  creado         timestamptz not null default now()
);

alter table public.personas enable row level security;

create policy "Usuarios con sesión pueden ver personas"
  on public.personas for select
  to authenticated
  using (true);

-- Enlazar los pagos con su persona (los pagos existentes se asignan por correo)
alter table public.pagos add column if not exists persona_id bigint references public.personas (id);

insert into public.personas (nombre, correo)
select distinct on (correo) nombre, correo
from public.pagos
order by correo, id desc
on conflict (correo) do nothing;

update public.pagos g
set persona_id = p.id
from public.personas p
where g.persona_id is null and p.correo = g.correo;

alter table public.pagos alter column persona_id set not null;
create index if not exists pagos_persona_idx on public.pagos (persona_id);

-- Tope: la suma de pagos de una persona no puede superar su meta
create or replace function public.validar_tope_pago()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_meta  integer;
  v_total bigint;
begin
  select meta_centavos into v_meta
  from public.personas where id = new.persona_id
  for update;  -- evita que dos pagos simultáneos superen la meta

  if v_meta is null then
    raise exception 'Persona no encontrada';
  end if;

  select coalesce(sum(monto_centavos), 0) into v_total
  from public.pagos where persona_id = new.persona_id;

  if v_total + new.monto_centavos > v_meta then
    raise exception 'El pago supera la meta. Pendiente: % centavos', v_meta - v_total
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger pagos_validar_tope
  before insert on public.pagos
  for each row execute function public.validar_tope_pago();

-- Resumen por persona para el listado
create or replace view public.personas_resumen
with (security_invoker = true) as
select
  p.id,
  p.nombre,
  p.correo,
  p.meta_centavos,
  coalesce(sum(g.monto_centavos), 0)::integer as pagado_centavos,
  count(g.id)::integer                         as num_pagos,
  max(g.fecha)                                 as ultimo_pago
from public.personas p
left join public.pagos g on g.persona_id = p.id
group by p.id;

grant select on public.personas_resumen to authenticated;
