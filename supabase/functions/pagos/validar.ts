const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TIPOS = ['servidor', 'participante'] as const;
export type Tipo = typeof TIPOS[number];

export interface DatosPersona {
  nombre: string;
  correo: string;
  tipo: Tipo;
}

const limpiarNombre = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const limpiarCorreo = (v: unknown) => String(v ?? '').trim().toLowerCase();

function erroresPersona(nombre: string, correo: string): string[] {
  const errores: string[] = [];
  if (nombre.length < 2 || nombre.length > 120) errores.push('Escribe el nombre completo.');
  if (!CORREO_RE.test(correo) || correo.length > 200) errores.push('El correo no es válido.');
  return errores;
}

export function esTipo(v: unknown): v is Tipo {
  return TIPOS.includes(v as Tipo);
}

/** Valida una persona nueva (formulario). */
export function validarPersona(body: Record<string, unknown>): { errores: string[]; datos: DatosPersona } {
  const nombre = limpiarNombre(body.nombre);
  const correo = limpiarCorreo(body.correo);
  const errores = erroresPersona(nombre, correo);
  if (!esTipo(body.tipo)) errores.push('Elige si es Servidor o Participante.');
  return { errores, datos: { nombre, correo, tipo: body.tipo as Tipo } };
}

export interface PersonaImportada {
  nombre: string;
  correo: string;
  cedula: string | null;
  whatsapp: string | null;
}

export interface ResultadoImportacion {
  validas: PersonaImportada[];
  omitidas: { fila: number; nombre: string; motivo: string }[];
}

/** Valida las filas de una hoja de inscripciones; descarta inválidas y correos repetidos. */
export function validarImportacion(filas: unknown): ResultadoImportacion {
  const resultado: ResultadoImportacion = { validas: [], omitidas: [] };
  if (!Array.isArray(filas)) return resultado;

  const vistos = new Set<string>();
  filas.forEach((f, i) => {
    const fila = (f ?? {}) as Record<string, unknown>;
    const nombre = limpiarNombre(fila.nombre);
    const correo = limpiarCorreo(fila.correo);
    const numero = Number(fila.fila) || i + 2;
    const omitir = (motivo: string) => resultado.omitidas.push({ fila: numero, nombre, motivo });

    if (nombre.length < 2) return omitir('Falta el nombre.');
    if (!correo) return omitir('Falta el correo.');
    const errores = erroresPersona(nombre, correo);
    if (errores.length) return omitir(errores.join(' '));
    if (vistos.has(correo)) return omitir(`Correo repetido en la hoja (${correo}).`);

    vistos.add(correo);
    const opcional = (v: unknown) => String(v ?? '').trim().slice(0, 40) || null;
    resultado.validas.push({ nombre, correo, cedula: opcional(fila.cedula), whatsapp: opcional(fila.whatsapp) });
  });
  return resultado;
}

/** Valida el monto de un pago (texto o número, hasta 2 decimales). */
export function validarMonto(valor: unknown): { error: string | null; centavos: number } {
  const texto = String(valor ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    return { error: 'El monto debe ser un número con hasta 2 decimales.', centavos: 0 };
  }
  const centavos = Math.round(Number(texto) * 100);
  if (centavos <= 0) return { error: 'El monto debe ser mayor que 0.', centavos };
  return { error: null, centavos };
}

/**
 * Personas sincronizadas que ya no están en la hoja.
 * Las que tienen pagos no se borran (se perderían sus recibos): se devuelven aparte para avisar.
 */
export function personasRetiradas<T extends { id: number; correo: string }>(
  existentes: T[], correosHoja: Iterable<string>, conPagos: Set<number>,
): { borrar: T[]; conservar: T[] } {
  const enHoja = new Set([...correosHoja].map((c) => c.trim().toLowerCase()).filter(Boolean));
  const fuera = existentes.filter((p) => !enHoja.has(p.correo.trim().toLowerCase()));
  return { borrar: fuera.filter((p) => !conPagos.has(p.id)), conservar: fuera.filter((p) => conPagos.has(p.id)) };
}
