// Envía una copia completa de los datos a la hoja de Google Sheets (Apps Script).
// Cada envío reescribe las pestañas, así que si uno falla el siguiente lo corrige.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface PersonaResumen {
  id: number;
  nombre: string;
  correo: string;
  tipo: string;
  tipo_nombre: string;
  meta_centavos: number;
  pagado_centavos: number;
  num_pagos: number;
  ultimo_pago: string | null;
  cedula: string | null;
  whatsapp: string | null;
}

export interface PagoFila {
  id: number;
  persona_id: number;
  monto_centavos: number;
  fecha: string;
  estado_correo: string;
}

export interface TipoFila {
  id: string;
  nombre: string;
  meta_centavos: number;
}

interface Hoja {
  nombre: string;
  encabezados: string[];
  filas: (string | number | null)[][];
  formatos: (string | null)[];
}

const usd = (c: number) => Math.round(c) / 100;
const plural = (n: string) => n + (/[aeiou]$/i.test(n) ? 's' : 'es');
const ESTADO_CORREO: Record<string, string> = { enviado: 'Enviado', error: 'No enviado', pendiente: 'Pendiente' };

function estadoPersona(p: PersonaResumen) {
  if (p.pagado_centavos >= p.meta_centavos) return 'Completo';
  return p.num_pagos ? 'Abonando' : 'Sin pagos';
}

/** Arma las pestañas Resumen, Personas y Pagos. */
export function armarHojas(tipos: TipoFila[], personas: PersonaResumen[], pagos: PagoFila[]): Hoja[] {
  const totales = (lista: PersonaResumen[]) => {
    const meta = lista.reduce((s, p) => s + p.meta_centavos, 0);
    const pagado = lista.reduce((s, p) => s + p.pagado_centavos, 0);
    return {
      n: lista.length, meta, pagado,
      completos: lista.filter((p) => p.pagado_centavos >= p.meta_centavos).length,
      abonando: lista.filter((p) => p.pagado_centavos < p.meta_centavos && p.num_pagos > 0).length,
      sinPagos: lista.filter((p) => p.num_pagos === 0).length,
    };
  };
  const filaResumen = (rol: string, metaPersona: number | null, t: ReturnType<typeof totales>) =>
    [rol, metaPersona === null ? '' : usd(metaPersona), t.n, usd(t.meta), usd(t.pagado), usd(t.meta - t.pagado),
      t.meta ? t.pagado / t.meta : 0, t.completos, t.abonando, t.sinPagos];

  const resumen: Hoja = {
    nombre: 'Resumen',
    encabezados: ['Rol', 'Meta por persona', 'Personas', 'Meta total', 'Recaudado', 'Por cobrar', 'Avance', 'Completos', 'Abonando', 'Sin pagos'],
    filas: [
      ...tipos.map((t) => filaResumen(plural(t.nombre), t.meta_centavos, totales(personas.filter((p) => p.tipo === t.id)))),
      filaResumen('Total', null, totales(personas)),
    ],
    formatos: [null, 'dinero', null, 'dinero', 'dinero', 'dinero', 'porcentaje', null, null, null],
  };

  const orden = new Map(tipos.map((t, i) => [t.id, i]));
  const personasOrdenadas = [...personas].sort((a, b) =>
    (orden.get(a.tipo) ?? 9) - (orden.get(b.tipo) ?? 9) || a.nombre.localeCompare(b.nombre, 'es'));

  const hojaPersonas: Hoja = {
    nombre: 'Personas',
    encabezados: ['Nombre', 'Rol', 'Correo', 'Cédula', 'WhatsApp', 'Meta', 'Pagado', 'Pendiente', 'Avance', 'Estado', 'N.º de pagos', 'Último pago'],
    filas: personasOrdenadas.map((p) => [
      p.nombre, p.tipo_nombre, p.correo, p.cedula ?? '', p.whatsapp ?? '',
      usd(p.meta_centavos), usd(p.pagado_centavos), usd(Math.max(p.meta_centavos - p.pagado_centavos, 0)),
      p.meta_centavos ? p.pagado_centavos / p.meta_centavos : 0,
      estadoPersona(p), p.num_pagos, p.ultimo_pago ?? '',
    ]),
    formatos: [null, null, null, null, null, 'dinero', 'dinero', 'dinero', 'porcentaje', null, null, 'fecha'],
  };

  const porId = new Map(personas.map((p) => [p.id, p]));
  const hojaPagos: Hoja = {
    nombre: 'Pagos',
    encabezados: ['Recibo N.º', 'Fecha', 'Nombre', 'Rol', 'Correo', 'Monto', 'Recibo por correo'],
    filas: [...pagos].sort((a, b) => a.id - b.id).map((g) => {
      const p = porId.get(g.persona_id);
      return [String(g.id).padStart(6, '0'), g.fecha, p?.nombre ?? '', p?.tipo_nombre ?? '', p?.correo ?? '',
        usd(g.monto_centavos), ESTADO_CORREO[g.estado_correo] ?? g.estado_correo];
    }),
    formatos: [null, 'fecha', null, null, null, 'dinero', null],
  };

  return [resumen, hojaPersonas, hojaPagos];
}

async function guardarAjuste(admin: SupabaseClient, clave: string, valor: string | null) {
  await admin.from('ajustes').upsert({ clave, valor, actualizado: new Date().toISOString() });
}

/** Envía los datos a la hoja. Nunca lanza error: devuelve el resultado. */
export async function actualizarDrive(admin: SupabaseClient): Promise<{ ok: boolean; omitido?: boolean; error?: string; url?: string }> {
  const { data: ajustes } = await admin.from('ajustes').select('clave, valor')
    .in('clave', ['drive_script_url', 'drive_token']);
  const conf = Object.fromEntries((ajustes ?? []).map((a) => [a.clave, a.valor]));
  if (!conf.drive_script_url || !conf.drive_token) return { ok: false, omitido: true, error: 'Hoja de Drive no configurada.' };

  try {
    const [tipos, personas, pagos] = await Promise.all([
      admin.from('tipos').select('id, nombre, meta_centavos').order('orden'),
      admin.from('personas_resumen').select('*'),
      admin.from('pagos').select('id, persona_id, monto_centavos, fecha, estado_correo'),
    ]);
    if (tipos.error || personas.error || pagos.error) throw new Error('No se pudieron leer los datos.');

    const res = await fetch(conf.drive_script_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token: conf.drive_token,
        generado: new Date().toISOString(),
        hojas: armarHojas(tipos.data, personas.data, pagos.data),
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(45000),
    });
    const texto = await res.text();
    let r: { ok?: boolean; error?: string; url?: string };
    try { r = JSON.parse(texto); } catch {
      throw new Error(res.ok ? 'Google no respondió como se esperaba. Revisa que la aplicación web tenga acceso "Cualquier usuario".' : `Google respondió ${res.status}.`);
    }
    if (!r.ok) throw new Error(r.error ?? 'Error desconocido en la hoja.');

    await Promise.all([
      guardarAjuste(admin, 'drive_actualizado_en', new Date().toISOString()),
      guardarAjuste(admin, 'drive_error', null),
      r.url ? guardarAjuste(admin, 'drive_hoja_url', r.url) : Promise.resolve(),
    ]);
    return { ok: true, url: r.url };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`Drive: ${error}`);
    await guardarAjuste(admin, 'drive_error', error);
    return { ok: false, error };
  }
}
