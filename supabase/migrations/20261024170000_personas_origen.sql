-- De dónde viene cada persona: 'hoja' (sincronizada desde Google Sheets) o 'manual' (alta desde la página).
-- Al sincronizar, las personas 'hoja' que ya no están en su hoja se quitan (si no tienen pagos).
alter table public.personas add column if not exists origen text not null default 'hoja'
  check (origen in ('hoja', 'manual'));
