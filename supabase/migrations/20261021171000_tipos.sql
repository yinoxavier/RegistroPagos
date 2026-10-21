-- Dos tipos de persona con su monto objetivo: Servidor $59 y Participante $65.
-- La meta de cada persona sale de su tipo; cambiar la meta del tipo la cambia para todos.

create table if not exists public.tipos (
  id             text    primary key,
  nombre         text    not null,
  meta_centavos  integer not null check (meta_centavos > 0),
  orden          integer not null default 0
);

alter table public.tipos enable row level security;

create policy "Usuarios con sesión pueden ver tipos"
  on public.tipos for select
  to authenticated
  using (true);

insert into public.tipos (id, nombre, meta_centavos, orden) values
  ('servidor',     'Servidor',     5900, 1),
  ('participante', 'Participante', 6500, 2)
on conflict (id) do nothing;

alter table public.personas
  add column if not exists tipo text not null default 'servidor' references public.tipos (id);

comment on column public.personas.meta_centavos is 'Sin uso: la meta viene de public.tipos';

create or replace function public.validar_tope_pago()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_meta  integer;
  v_total bigint;
begin
  select t.meta_centavos into v_meta
  from public.personas p
  join public.tipos t on t.id = p.tipo
  where p.id = new.persona_id
  for update of p;  -- evita que dos pagos simultáneos superen la meta

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

-- Mismas columnas que antes (meta ahora desde el tipo) + tipo al final
create or replace view public.personas_resumen
with (security_invoker = true) as
select
  p.id,
  p.nombre,
  p.correo,
  t.meta_centavos,
  coalesce(sum(g.monto_centavos), 0)::integer as pagado_centavos,
  count(g.id)::integer                         as num_pagos,
  max(g.fecha)                                 as ultimo_pago,
  p.tipo,
  t.nombre                                     as tipo_nombre
from public.personas p
join public.tipos t on t.id = p.tipo
left join public.pagos g on g.persona_id = p.id
group by p.id, t.id;

grant select on public.personas_resumen to authenticated;
