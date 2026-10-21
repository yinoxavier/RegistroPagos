import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

export interface Pago {
  id: number;
  nombre: string;
  correo: string;
  monto_centavos: number;
  fecha: string;
  persona_id?: number;
  estado_correo?: string;
  error_correo?: string | null;
}

/** Avance de la persona al momento de este pago (para el recibo y el correo). */
export interface Avance {
  tipoNombre: string;
  metaCentavos: number;
  acumuladoCentavos: number; // suma de pagos hasta este, incluido
}

export const saldo = (a: Avance) => Math.max(a.metaCentavos - a.acumuladoCentavos, 0);

export const ORGANIZACION = Deno.env.get('ORG_NOMBRE') ?? 'Comunidad Católica Shalom';
const ZONA = Deno.env.get('ZONA_HORARIA') ?? 'America/Panama';
const MONEDA = Deno.env.get('MONEDA') ?? 'USD';

export const numeroRecibo = (id: number) => String(id).padStart(6, '0');

export function formatearMonto(centavos: number) {
  const valor = (centavos / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${valor} ${MONEDA}`;
}

export function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString('es-PA', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const hex = (h: string) =>
  rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

const AZUL = hex('#1f3a5f');
const GRIS = hex('#5b6573');
const LINEA = hex('#d9dee5');
const FONDO = hex('#f3f6fa');
const NEGRO = rgb(0, 0, 0);
const BLANCO = rgb(1, 1, 1);

/** Genera el recibo de un pago como PDF (tamaño carta). */
export async function generarRecibo(pago: Pago, avance?: Avance): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Recibo ${numeroRecibo(pago.id)}`);
  pdf.setAuthor(ORGANIZACION);

  const page = pdf.addPage([612, 792]);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width: W, height: H } = page.getSize();
  const M = 56;
  const ancho = W - M * 2;

  // pdf-lib mide desde abajo: convertimos "y desde arriba" a coordenadas reales
  const top = (y: number, size: number) => H - y - size;
  const derecha = (texto: string, size: number, font = normal) =>
    M + ancho - font.widthOfTextAtSize(texto, size);

  // Encabezado
  page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: AZUL });
  page.drawText(ORGANIZACION, { x: M, y: top(38, 20), size: 20, font: negrita, color: BLANCO });
  page.drawText('Recibo de pago', { x: M, y: top(68, 11), size: 11, font: normal, color: BLANCO });

  // Número y fecha
  const fecha = formatearFecha(pago.fecha);
  page.drawText('RECIBO N.º', { x: M, y: top(140, 10), size: 10, font: normal, color: GRIS });
  page.drawText(numeroRecibo(pago.id), { x: M, y: top(154, 16), size: 16, font: negrita, color: NEGRO });
  page.drawText('FECHA', { x: derecha('FECHA', 10), y: top(140, 10), size: 10, font: normal, color: GRIS });
  page.drawText(fecha, { x: derecha(fecha, 12), y: top(156, 12), size: 12, font: normal, color: NEGRO });

  page.drawLine({ start: { x: M, y: H - 190 }, end: { x: M + ancho, y: H - 190 }, thickness: 1, color: LINEA });

  // Datos del pagador
  let y = 214;
  const fila = (etiqueta: string, valor: string) => {
    page.drawText(etiqueta.toUpperCase(), { x: M, y: top(y, 10), size: 10, font: normal, color: GRIS });
    page.drawText(valor, { x: M, y: top(y + 15, 13), size: 13, font: normal, color: NEGRO, maxWidth: ancho });
    y += 50;
  };
  // La fuente estándar no admite todos los caracteres (p. ej. emojis): se reemplazan
  const limpiar = (s: string) =>
    [...s].map((c) => {
      try { normal.encodeText(c); return c; } catch { return '?'; }
    }).join('');
  fila('Recibimos de', limpiar(pago.nombre));
  fila('Correo electrónico', limpiar(pago.correo));

  // Monto destacado
  page.drawRectangle({
    x: M, y: H - y - 70, width: ancho, height: 70,
    color: FONDO, borderColor: LINEA, borderWidth: 1,
  });
  page.drawText('MONTO RECIBIDO', { x: M + 18, y: top(y + 16, 10), size: 10, font: normal, color: GRIS });
  page.drawText(formatearMonto(pago.monto_centavos), {
    x: M + 18, y: top(y + 32, 24), size: 24, font: negrita, color: AZUL,
  });
  y += 100;

  // Avance hacia la meta
  if (avance) {
    const filas: [string, string][] = [
      ['Tipo', avance.tipoNombre],
      ['Meta', formatearMonto(avance.metaCentavos)],
      ['Total abonado', formatearMonto(avance.acumuladoCentavos)],
      ['Saldo pendiente', saldo(avance) === 0 ? 'Pagado completo' : formatearMonto(saldo(avance))],
    ];
    for (const [etiqueta, valor] of filas) {
      page.drawText(etiqueta, { x: M, y: top(y, 11), size: 11, font: normal, color: GRIS });
      page.drawText(valor, { x: derecha(valor, 11, negrita), y: top(y, 11), size: 11, font: negrita, color: NEGRO });
      y += 22;
    }
    // Barra de progreso
    const pct = Math.min(avance.acumuladoCentavos / avance.metaCentavos, 1);
    page.drawRectangle({ x: M, y: H - y - 8, width: ancho, height: 8, color: LINEA });
    if (pct > 0) page.drawRectangle({ x: M, y: H - y - 8, width: ancho * pct, height: 8, color: AZUL });
    y += 34;
  }

  page.drawText(
    `Gracias por su aporte. Este documento certifica que ${ORGANIZACION} recibió el pago indicado.`,
    { x: M, y: top(y, 10), size: 10, font: normal, color: GRIS, maxWidth: ancho, lineHeight: 14 },
  );

  // Pie
  const pie = `${ORGANIZACION} · Recibo generado electrónicamente`;
  page.drawText(pie, {
    x: (W - normal.widthOfTextAtSize(pie, 9)) / 2, y: 70, size: 9, font: normal, color: GRIS,
  });

  return await pdf.save();
}
