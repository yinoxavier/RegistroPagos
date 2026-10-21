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

-- Seguridad: con RLS activo y solo esta regla de lectura, nadie escribe desde el navegador.
-- Los registros los crea la función "pagos" con la clave secreta.
alter table public.pagos enable row level security;

create policy "Usuarios con sesión pueden ver pagos"
  on public.pagos for select
  to authenticated
  using (true);
