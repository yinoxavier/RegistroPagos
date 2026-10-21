// Pruebas locales: deno test --allow-env --allow-write --allow-read --allow-sys supabase/functions/pagos
import { deepStrictEqual as assertEquals } from 'node:assert';
import { validarImportacion, validarMonto, validarPersona } from './validar.ts';
import { formatearMonto, generarRecibo, numeroRecibo, type Avance, type Pago } from './recibo.ts';
import { armarMensaje, datosNodemailer } from './correo.ts';
import nodemailer from 'npm:nodemailer@6.10.1';

const pago: Pago = {
  id: 7, nombre: 'José <Pérez>', correo: 'jose@example.com',
  monto_centavos: 1000, fecha: '2026-10-21T05:55:44Z', persona_id: 1,
};
const avance: Avance = { tipoNombre: 'Servidor', metaCentavos: 5900, acumuladoCentavos: 4000 };

Deno.test('valida persona nueva con tipo', () => {
  const ok = validarPersona({ nombre: '  Ana   Ruiz ', correo: 'Ana@Example.com', tipo: 'participante' });
  assertEquals(ok.errores, []);
  assertEquals(ok.datos, { nombre: 'Ana Ruiz', correo: 'ana@example.com', tipo: 'participante' });
  assertEquals(validarPersona({ nombre: 'Ana Ruiz', correo: 'a@b.co', tipo: 'otro' }).errores.length, 1);
  assertEquals(validarPersona({ nombre: 'A', correo: 'malo', tipo: 'servidor' }).errores.length, 2);
});

Deno.test('importación: descarta inválidas y correos repetidos', () => {
  const r = validarImportacion([
    { fila: 2, nombre: 'Ana Ruiz', correo: 'ana@example.com' },
    { fila: 3, nombre: 'Ana R.', correo: 'ANA@example.com ' },
    { fila: 4, nombre: '', correo: 'x@example.com' },
    { fila: 5, nombre: 'Luis Gómez', correo: 'sin-correo' },
    { fila: 6, nombre: 'Marta Díaz', correo: 'marta@example.com' },
  ]);
  assertEquals(r.validas.map((v) => v.correo), ['ana@example.com', 'marta@example.com']);
  assertEquals(r.omitidas.map((o) => o.fila), [3, 4, 5]);
});

Deno.test('valida montos', () => {
  assertEquals(validarMonto('25,5'), { error: null, centavos: 2550 });
  assertEquals(validarMonto('0').error !== null, true);
  assertEquals(validarMonto('1.234').error !== null, true);
  assertEquals(validarMonto('-3').error !== null, true);
});

Deno.test('formatea número de recibo y monto', () => {
  assertEquals(numeroRecibo(42), '000042');
  assertEquals(formatearMonto(125000), '$1,250.00 USD');
});

Deno.test('genera recibos con y sin avance, con tildes y emojis', async () => {
  const conAvance = await generarRecibo({ ...pago, nombre: 'Juan Ñúñez' }, avance);
  assertEquals(new TextDecoder().decode(conAvance.slice(0, 5)), '%PDF-');
  const completo = await generarRecibo({ ...pago, nombre: 'Ana 🙏 Łukasz' }, { ...avance, acumuladoCentavos: 5900 });
  assertEquals(completo.length > 0, true);
  const sinAvance = await generarRecibo(pago);
  assertEquals(sinAvance.length > 0, true);
  const salida = Deno.env.get('RECIBO_SALIDA');
  if (salida) await Deno.writeFile(salida, conAvance);
});

Deno.test('arma el correo con el PDF adjunto y el saldo', async () => {
  const pdf = await generarRecibo(pago, avance);
  const m = armarMensaje(pago, pdf, avance);
  assertEquals(m.html.includes('José &lt;Pérez&gt;'), true);
  assertEquals(m.html.includes('Saldo pendiente: <strong>$19.00 USD</strong>'), true);
  const fin = armarMensaje(pago, pdf, { ...avance, acumuladoCentavos: 5900 });
  assertEquals(fin.html.includes('completaste tu aporte'), true);

  const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await t.sendMail(datosNodemailer(m, 'recibos@gmail.com'));
  const raw = info.message.toString();
  assertEquals(raw.includes('filename=recibo-000007.pdf'), true);
  assertEquals(raw.includes('Content-Type: application/pdf'), true);
});

import { detectarColumnas, idDesdeEnlace, leerInscripciones, parsearCsv } from './hoja.ts';

Deno.test('extrae id y gid del enlace de Google Sheets', () => {
  assertEquals(
    idDesdeEnlace('https://docs.google.com/spreadsheets/d/1ziK2nA2ljo0nfoHGnXSB4FmiyEHpPuynnv6QgrXkNuU/edit?usp=sharing'),
    { id: '1ziK2nA2ljo0nfoHGnXSB4FmiyEHpPuynnv6QgrXkNuU', gid: '0' },
  );
  assertEquals(idDesdeEnlace('https://docs.google.com/spreadsheets/d/1kzidEepJiatmbaPzvl_vYDb9YV0mQ4D07ePCk2SoR-4/edit#gid=123')?.gid, '123');
  assertEquals(idDesdeEnlace('no es un enlace'), null);
});

Deno.test('parsea CSV con comillas, comas y saltos de línea', () => {
  assertEquals(parsearCsv('a,"b, c","d ""x"""\r\n1,"dos\nlineas",3\n'), [['a', 'b, c', 'd "x"'], ['1', 'dos\nlineas', '3']]);
});

Deno.test('detecta columnas de la hoja de Participantes', () => {
  const enc = ['Fecha de registro', 'Nombre completo', '', 'Cédula o pasaporte', 'Fecha de nacimiento', 'Edad',
    'Responsable (si es menor)', 'Contacto del responsable', 'WhatsApp', 'Dirección', 'Redes sociales',
    'Correo electrónico', 'Enfermedad / medicamentos', 'Alergias / intolerancias', 'Contacto de emergencia',
    'Teléfono de emergencia', 'Acepta datos e imagen', 'Forma de pago', 'Comprobante de pago', '¿Documento repetido?'];
  assertEquals(detectarColumnas(enc), { nombre: 1, apellido: -1, correo: 11, cedula: 3, whatsapp: 8 });
});

Deno.test('lee la hoja de Servidores (sin correo todavía) y omite filas vacías', () => {
  const csv = 'Fecha de registro,Nombre completo,,Cédula,WhatsApp,¿Cómo vas a llegar a la finca?,Grupo de oración / pastoral / movimiento,¿Estás sirviendo?,Equipo o servicio,Enfermedad / medicamentos,Alergias / intolerancias,Forma de pago,Comprobante de pago,¿Cédula repetida?\n' +
    '21/10/2026 10:36:19,Yino Segura,,8-000-0000,60000000,En mi auto,Cal,Ya tengo un equipo,Juegos,,,Yappy,,\n,,,,,,,,,,,,,\n';
  const { columnas, filas } = leerInscripciones(csv);
  assertEquals(columnas.correo, -1);
  assertEquals(columnas.cedula, 3);
  assertEquals(filas.length, 1);
  assertEquals(filas[0], { fila: 2, nombre: 'Yino Segura', correo: '', cedula: '8-000-0000', whatsapp: '60000000' });
  const v = validarImportacion(filas);
  assertEquals(v.omitidas[0].motivo, 'Falta el correo.');
});
