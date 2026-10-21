const PDFDocument = require('pdfkit');
const config = require('./config');
const { numeroRecibo, formatearMonto, formatearFecha } = require('./formato');

const AZUL = '#1f3a5f';
const GRIS = '#5b6573';
const LINEA = '#d9dee5';

/** Genera el recibo de un pago y devuelve el PDF como Buffer. */
function generarRecibo(pago) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56, info: {
      Title: `Recibo ${numeroRecibo(pago.id)}`,
      Author: config.organizacion,
    } });
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const izq = doc.page.margins.left;
    const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Encabezado
    doc.rect(0, 0, doc.page.width, 110).fill(AZUL);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text(config.organizacion, izq, 38, { width: ancho });
    doc.font('Helvetica').fontSize(11)
      .text('Recibo de pago', izq, 66, { width: ancho });

    // Número y fecha
    doc.fillColor(GRIS).fontSize(10).text('RECIBO N.º', izq, 140);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(16)
      .text(numeroRecibo(pago.id), izq, 154);
    doc.fillColor(GRIS).font('Helvetica').fontSize(10)
      .text('FECHA', izq, 140, { width: ancho, align: 'right' });
    doc.fillColor('#000').fontSize(12)
      .text(formatearFecha(pago.fecha), izq, 156, { width: ancho, align: 'right' });

    doc.moveTo(izq, 190).lineTo(izq + ancho, 190).strokeColor(LINEA).stroke();

    // Datos del pagador
    let y = 214;
    const fila = (etiqueta, valor) => {
      doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(etiqueta.toUpperCase(), izq, y);
      doc.fillColor('#000').fontSize(13).text(valor, izq, y + 14, { width: ancho });
      y += 50;
    };
    fila('Recibimos de', pago.nombre);
    fila('Correo electrónico', pago.correo);

    // Monto destacado
    doc.roundedRect(izq, y, ancho, 70, 6).fillAndStroke('#f3f6fa', LINEA);
    doc.fillColor(GRIS).fontSize(10).text('MONTO RECIBIDO', izq + 18, y + 16);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(24)
      .text(formatearMonto(pago.monto_centavos), izq + 18, y + 30);
    y += 110;

    doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(
      `Gracias por su aporte. Este documento certifica que ${config.organizacion} ` +
        'recibió el pago indicado.',
      izq, y, { width: ancho }
    );

    // Pie
    doc.fontSize(9).fillColor(GRIS).text(
      `${config.organizacion} · Recibo generado electrónicamente`,
      izq, doc.page.height - 80, { width: ancho, align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generarRecibo };
