-- Agrega cédula y WhatsApp al resumen (para buscar por cédula en la página).
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
  t.nombre                                     as tipo_nombre,
  p.cedula,
  p.whatsapp
from public.personas p
join public.tipos t on t.id = p.tipo
left join public.pagos g on g.persona_id = p.id
group by p.id, t.id;
