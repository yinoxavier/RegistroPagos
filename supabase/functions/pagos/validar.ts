const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DatosPago {
  nombre: string;
  correo: string;
  montoCentavos: number;
}

/** Valida y normaliza los datos del formulario. */
export function validarPago(body: Record<string, unknown>): { errores: string[]; datos: DatosPago } {
  const nombre = String(body.nombre ?? '').trim().replace(/\s+/g, ' ');
  const correo = String(body.correo ?? '').trim().toLowerCase();
  const montoTexto = String(body.monto ?? '').trim().replace(',', '.');
  const errores: string[] = [];

  if (nombre.length < 2 || nombre.length > 120) errores.push('Escribe el nombre completo.');
  if (!CORREO_RE.test(correo) || correo.length > 200) errores.push('El correo no es válido.');
  if (!/^\d+(\.\d{1,2})?$/.test(montoTexto)) {
    errores.push('El monto debe ser un número con hasta 2 decimales.');
  }

  const montoCentavos = Math.round(Number(montoTexto) * 100);
  if (!errores.length && (montoCentavos <= 0 || montoCentavos > 100_000_000)) {
    errores.push('El monto debe ser mayor que 0.');
  }
  return { errores, datos: { nombre, correo, montoCentavos } };
}
