// Función "pagos": registra un pago, genera el recibo PDF y lo envía por correo.
//
// Acciones (POST con JSON y la sesión del usuario en Authorization):
//   { accion: "registrar", nombre, correo, monto }
//   { accion: "reenviar", id }
//   { accion: "recibo", id }   -> devuelve el PDF
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generarRecibo, numeroRecibo, type Pago } from './recibo.ts';
import { enviarRecibo } from './correo.ts';
import { validarPago } from './validar.ts';

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

async function obtenerPago(id: number): Promise<Pago | null> {
  const { data } = await admin.from('pagos').select('*').eq('id', id).maybeSingle();
  return data;
}

/** Genera el PDF, lo envía y guarda el resultado del envío. */
async function procesarCorreo(pago: Pago): Promise<Pago> {
  let estado = 'enviado';
  let error: string | null = null;
  try {
    await enviarRecibo(pago, await generarRecibo(pago));
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ errores: ['Método no permitido.'] }, 405);

  // Solo usuarios con sesión iniciada
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ errores: ['Sesión no válida. Vuelve a ingresar.'] }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  switch (body.accion) {
    case 'registrar': {
      const { errores, datos } = validarPago(body);
      if (errores.length) return json({ errores }, 400);

      const { data: pago, error } = await admin.from('pagos').insert({
        nombre: datos.nombre,
        correo: datos.correo,
        monto_centavos: datos.montoCentavos,
        registrado_por: auth.user.id,
      }).select('*').single();
      if (error || !pago) return json({ errores: ['No se pudo guardar el pago.'] }, 500);

      return json(await procesarCorreo(pago), 201);
    }

    case 'reenviar': {
      const pago = await obtenerPago(Number(body.id));
      if (!pago) return json({ errores: ['Pago no encontrado.'] }, 404);
      return json(await procesarCorreo(pago));
    }

    case 'recibo': {
      const pago = await obtenerPago(Number(body.id));
      if (!pago) return json({ errores: ['Pago no encontrado.'] }, 404);
      const pdf = await generarRecibo(pago);
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
