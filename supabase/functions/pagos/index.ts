// Función "pagos": personas, pagos con tope por tipo, recibo PDF y envío por correo.
//
// Acciones (POST con JSON y la sesión del usuario en Authorization):
//   { accion: "crear_persona", nombre, correo, tipo }
//   { accion: "sincronizar" }                 -> lee las hojas de Google Sheets de cada tipo
//   { accion: "configurar_hoja", tipo, enlace }
//   { accion: "registrar", persona_id, monto }
//   { accion: "reenviar", id }
//   { accion: "recibo", id }   -> devuelve el PDF
import { createClient } from 'npm:@supabase/supabase-js@2';
import { formatearMonto, generarRecibo, numeroRecibo, type Avance, type Pago } from './recibo.ts';
import { enviarRecibo } from './correo.ts';
import { esTipo, validarImportacion, validarMonto, validarPersona } from './validar.ts';
import { descargarHoja, idDesdeEnlace, leerInscripciones } from './hoja.ts';

const ORIGEN = Deno.env.get('ORIGEN_PERMITIDO') ?? 'https://yinoxavier.github.io';
const cors = {
  'Access-Control-Allow-Origin': ORIGEN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function claveSecreta(): string {
  try {
    const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (claves.default) return claves.default;
  } catch { /* se usa la clave heredada */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, claveSecreta(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MAX_IMPORTAR = 3000;
const NOMBRE_TIPO: Record<string, string> = { servidor: 'Servidor', participante: 'Participante' };

async function obtenerPago(id: number): Promise<Pago | null> {
  const { data } = await admin.from('pagos').select('*').eq('id', id).maybeSingle();
  return data;
}

/** Avance de la persona contando los pagos hasta este (incluido). */
async function obtenerAvance(pago: Pago): Promise<Avance | undefined> {
  if (!pago.persona_id) return undefined;
  const [{ data: persona }, { data: pagos }] = await Promise.all([
    admin.from('personas').select('tipos(nombre, meta_centavos)').eq('id', pago.persona_id).single(),
    admin.from('pagos').select('monto_centavos').eq('persona_id', pago.persona_id).lte('id', pago.id),
  ]);
  const tipo = (persona as { tipos?: { nombre: string; meta_centavos: number } } | null)?.tipos;
  if (!tipo) return undefined;
  return {
    tipoNombre: tipo.nombre,
    metaCentavos: tipo.meta_centavos,
    acumuladoCentavos: (pagos ?? []).reduce((s, p) => s + p.monto_centavos, 0),
  };
}

/** Genera el PDF, lo envía y guarda el resultado del envío. */
async function procesarCorreo(pago: Pago): Promise<Pago> {
  let estado = 'enviado';
  let error: string | null = null;
  try {
    const avance = await obtenerAvance(pago);
    await enviarRecibo(pago, await generarRecibo(pago, avance), avance);
  } catch (e) {
    estado = 'error';
    error = e instanceof Error ? e.message : String(e);
    console.error(`Recibo ${pago.id}: ${error}`);
  }
  const { data } = await admin.from('pagos')
    .update({ estado_correo: estado, error_correo: error })
    .eq('id', pago.id).select('*').single();
  return data ?? { ...pago, estado_correo: estado, error_correo: error };
}

async function crearPersona(body: Record<string, unknown>) {
  const { errores, datos } = validarPersona(body);
  if (errores.length) return json({ errores }, 400);

  const { data, error } = await admin.from('personas').insert(datos).select('*').single();
  if (error?.code === '23505') {
    return json({ errores: [`Ya hay una persona registrada con el correo ${datos.correo}.`] }, 409);
  }
  if (error || !data) return json({ errores: ['No se pudo guardar la persona.'] }, 500);
  return json(data, 201);
}

interface ResumenSincronizacion {
  tipo: string;
  tipo_nombre: string;
  filas: number;
  creadas: number;
  actualizadas: number;
  sin_cambios: number;
  omitidas: { fila: number; nombre: string; motivo: string }[];
  error?: string;
}

/** Lee la hoja de un tipo y crea o actualiza sus personas (por correo). */
async function sincronizarTipo(tipo: { id: string; nombre: string; hoja_id: string; hoja_gid: string }):
  Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = {
    tipo: tipo.id, tipo_nombre: tipo.nombre, filas: 0, creadas: 0, actualizadas: 0, sin_cambios: 0, omitidas: [],
  };
  try {
    const { columnas, filas } = leerInscripciones(await descargarHoja(tipo.hoja_id, tipo.hoja_gid));
    if (columnas.correo < 0 && filas.length) {
      resumen.error = 'La hoja no tiene columna de correo. Agrega la pregunta "Correo electrónico" al formulario.';
      return resumen;
    }
    if (filas.length > MAX_IMPORTAR) {
      resumen.error = `La hoja tiene más de ${MAX_IMPORTAR} filas.`;
      return resumen;
    }
    resumen.filas = filas.length;
    Object.assign(resumen, await guardarPersonas(tipo.id, filas));
    await admin.from('tipos').update({ sincronizado_en: new Date().toISOString() }).eq('id', tipo.id);
  } catch (e) {
    resumen.error = e instanceof Error ? e.message : String(e);
  }
  return resumen;
}

async function sincronizar() {
  const { data: tipos, error } = await admin.from('tipos')
    .select('id, nombre, hoja_id, hoja_gid').not('hoja_id', 'is', null).order('orden');
  if (error) return json({ errores: ['No se pudo leer la configuración de hojas.'] }, 500);
  if (!tipos?.length) return json({ errores: ['No hay hojas de inscripción configuradas.'] }, 400);

  const resultados = [];
  for (const t of tipos) resultados.push(await sincronizarTipo(t));
  return json({ resultados });
}

async function configurarHoja(body: Record<string, unknown>) {
  if (!esTipo(body.tipo)) return json({ errores: ['Tipo no válido.'] }, 400);
  const datos = idDesdeEnlace(String(body.enlace ?? ''));
  if (!datos) return json({ errores: ['Pega el enlace completo de la hoja de Google Sheets.'] }, 400);

  try {
    leerInscripciones(await descargarHoja(datos.id, datos.gid));
  } catch (e) {
    return json({ errores: [e instanceof Error ? e.message : String(e)] }, 400);
  }
  const { error } = await admin.from('tipos').update({ hoja_id: datos.id, hoja_gid: datos.gid }).eq('id', body.tipo);
  if (error) return json({ errores: ['No se pudo guardar el enlace.'] }, 500);
  return json({ ok: true });
}

/** Crea personas nuevas y actualiza datos de las existentes del mismo tipo (por correo). */
async function guardarPersonas(tipo: string, filas: unknown[]) {
  const { validas, omitidas } = validarImportacion(filas);

  type Existente = { id: number; nombre: string; correo: string; tipo: string; cedula: string | null; whatsapp: string | null };
  const existentes = new Map<string, Existente>();
  for (let i = 0; i < validas.length; i += 500) {
    const correos = validas.slice(i, i + 500).map((v) => v.correo);
    const { data, error } = await admin.from('personas')
      .select('id, nombre, correo, tipo, cedula, whatsapp').in('correo', correos);
    if (error) throw new Error('No se pudo leer el listado actual.');
    for (const p of data ?? []) existentes.set(p.correo, p);
  }

  const nuevas: Record<string, unknown>[] = [];
  const cambios: { id: number; datos: Record<string, unknown> }[] = [];
  let sinCambios = 0;

  for (const v of validas) {
    const actual = existentes.get(v.correo);
    if (!actual) {
      nuevas.push({ ...v, tipo });
      continue;
    }
    if (actual.tipo !== tipo) {
      omitidas.push({
        fila: 0, nombre: v.nombre,
        motivo: `${v.correo} ya está registrado como ${NOMBRE_TIPO[actual.tipo] ?? actual.tipo}.`,
      });
      continue;
    }
    const datos: Record<string, unknown> = {};
    if (actual.nombre !== v.nombre) datos.nombre = v.nombre;
    if (v.cedula && actual.cedula !== v.cedula) datos.cedula = v.cedula;
    if (v.whatsapp && actual.whatsapp !== v.whatsapp) datos.whatsapp = v.whatsapp;
    if (Object.keys(datos).length) cambios.push({ id: actual.id, datos });
    else sinCambios++;
  }

  for (let i = 0; i < nuevas.length; i += 500) {
    const { error } = await admin.from('personas').insert(nuevas.slice(i, i + 500));
    if (error) throw new Error(`Error al guardar personas nuevas: ${error.message}`);
  }
  for (const c of cambios) {
    await admin.from('personas').update(c.datos).eq('id', c.id);
  }

  return { creadas: nuevas.length, actualizadas: cambios.length, sin_cambios: sinCambios, omitidas };
}

async function registrarPago(body: Record<string, unknown>, usuarioId: string) {
  const personaId = Number(body.persona_id);
  if (!Number.isInteger(personaId) || personaId <= 0) {
    return json({ errores: ['Elige la persona que hace el pago.'] }, 400);
  }
  const { error: errMonto, centavos } = validarMonto(body.monto);
  if (errMonto) return json({ errores: [errMonto] }, 400);

  const { data: persona } = await admin.from('personas_resumen').select('*').eq('id', personaId).maybeSingle();
  if (!persona) return json({ errores: ['Persona no encontrada.'] }, 404);

  const pendiente = persona.meta_centavos - persona.pagado_centavos;
  if (pendiente <= 0) return json({ errores: [`${persona.nombre} ya completó su aporte.`] }, 400);
  if (centavos > pendiente) {
    return json({ errores: [`El monto supera lo pendiente. A ${persona.nombre} le faltan ${formatearMonto(pendiente)}.`] }, 400);
  }

  const { data: pago, error } = await admin.from('pagos').insert({
    persona_id: personaId,
    nombre: persona.nombre,
    correo: persona.correo,
    monto_centavos: centavos,
    registrado_por: usuarioId,
  }).select('*').single();

  if (error?.code === 'P0001') return json({ errores: ['El monto supera lo pendiente. Actualiza la página e intenta de nuevo.'] }, 409);
  if (error || !pago) return json({ errores: ['No se pudo guardar el pago.'] }, 500);

  return json(await procesarCorreo(pago), 201);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ errores: ['Método no permitido.'] }, 405);

  // Solo usuarios con sesión iniciada
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ errores: ['Sesión no válida. Vuelve a ingresar.'] }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  switch (body.accion) {
    case 'crear_persona':
      return await crearPersona(body);

    case 'sincronizar':
      return await sincronizar();

    case 'configurar_hoja':
      return await configurarHoja(body);

    case 'registrar':
      return await registrarPago(body, auth.user.id);

    case 'reenviar': {
      const pago = await obtenerPago(Number(body.id));
      if (!pago) return json({ errores: ['Pago no encontrado.'] }, 404);
      return json(await procesarCorreo(pago));
    }

    case 'recibo': {
      const pago = await obtenerPago(Number(body.id));
      if (!pago) return json({ errores: ['Pago no encontrado.'] }, 404);
      const pdf = await generarRecibo(pago, await obtenerAvance(pago));
      return new Response(new Blob([pdf as Uint8Array<ArrayBuffer>]), {
        headers: {
          ...cors,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="recibo-${numeroRecibo(pago.id)}.pdf"`,
        },
      });
    }

    default:
      return json({ errores: ['Acción no válida.'] }, 400);
  }
});
