-- Tabla de pagos
create table if not exists public.pagos (
  id              bigint generated always as identity primary key,
  nombre          text        not null check (char_length(nombre) between 2 and 120),
  correo          text        not null check (correo ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  monto_centavos  integer     not null check (monto_centavos > 0),
  fecha           timestamptz not null default now(),
  estado_correo   text        not null default 'pendiente'
                  check (estado_correo in ('pendiente', 'enviado', 'error')),
  error_correo    text,
  registrado_por  uuid        references auth.users (id) on delete set null
);

create index if not exists pagos_fecha_idx on public.pagos (fecha desc);

-- Seguridad: solo usuarios con sesión pueden ver los pagos.
-- Nadie escribe desde el navegador: los registros los crea la función "pagos".
alter table public.pagos enable row level security;

revoke all on public.pagos from anon;
revoke insert, update, delete on public.pagos from authenticated;
grant select on public.pagos to authenticated;

drop policy if exists "Usuarios con sesión pueden ver pagos" on public.pagos;
create policy "Usuarios con sesión pueden ver pagos"
  on public.pagos for select
  to authenticated
  using (true);
