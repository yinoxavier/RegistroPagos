-- Hoja de Google Sheets de inscripciones por tipo, y datos extra de cada persona.

alter table public.tipos add column if not exists hoja_id text;
alter table public.tipos add column if not exists hoja_gid text not null default '0';
alter table public.tipos add column if not exists sincronizado_en timestamptz;

update public.tipos
set hoja_id = '1kzidEepJiatmbaPzvl_vYDb9YV0mQ4D07ePCk2SoR-4'
where id = 'servidor' and hoja_id is null;

alter table public.personas add column if not exists cedula text;
alter table public.personas add column if not exists whatsapp text;
