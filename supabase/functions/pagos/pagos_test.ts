// Pruebas locales: deno test --allow-env --allow-write --allow-read --allow-sys supabase/functions/pagos
import { deepStrictEqual as assertEquals } from 'node:assert';
import { validarImportacion, validarMonto, validarPersona } from './validar.ts';
import { establecerLogo, formatearMonto, generarRecibo, numeroRecibo, type Avance, type Pago } from './recibo.ts';
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
  establecerLogo(await Deno.readFile(new URL('../../../web/logo-blanco.png', import.meta.url)));
  const conAvance = await generarRecibo({ ...pago, nombre: 'Juan Ñúñez' }, avance);
  assertEquals(new TextDecoder().decode(conAvance.slice(0, 5)), '%PDF-');
  const completo = await generarRecibo({ ...pago, nombre: 'Ana 🙏 Łukasz' }, { ...avance, acumuladoCentavos: 5900 });
  assertEquals(completo.length > 0, true);
  const sinAvance = await generarRecibo(pago);
  assertEquals(sinAvance.length > 0, true);
  establecerLogo(new Uint8Array([1, 2, 3])); // logo dañado: debe caer al texto sin fallar
  assertEquals((await generarRecibo(pago)).length > 0, true);
  establecerLogo(await Deno.readFile(new URL('../../../web/logo-blanco.png', import.meta.url)));
  const salida = Deno.env.get('RECIBO_SALIDA');
  if (salida) await Deno.writeFile(salida, conAvance);
});

Deno.test('arma el correo con el PDF adjunto y el saldo', async () => {
  const pdf = await generarRecibo(pago, avance);
  const m = armarMensaje(pago, pdf, avance);
  assertEquals(m.html.includes('José &lt;Pérez&gt;'), true);
  assertEquals(m.html.includes('Saldo pendiente: <strong>$19.00 USD</strong>'), true);
  assertEquals(/Hemos recibido tu pago de <strong>\$10\.00 USD<\/strong> para el\s+<strong>Camps 2027<\/strong>/.test(m.html), true);
  assertEquals(m.html.includes('Nota:'), false);
  assertEquals(m.asunto, 'Recibo de pago N.º 000007 - Camps 2027 - Comunidad Católica Shalom');
  const fin = armarMensaje(pago, pdf, { ...avance, acumuladoCentavos: 5900 });
  assertEquals(fin.html.includes('completaste tu aporte de $59.00 USD para el Camps 2027'), true);

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

Deno.test('lee la hoja nueva de Servidores (correo al final)', () => {
  const csv = 'Fecha de registro,Nombre completo,Cédula,WhatsApp,¿Cómo vas a llegar a la finca?,Grupo de oración / pastoral / movimiento,¿Estás sirviendo?,Equipo o servicio,Enfermedad / medicamentos,Alergias / intolerancias,Forma de pago,Comprobante de pago,¿Cédula repetida?,Correo electrónico\n' +
    '21/10/2026 14:10:00,Ana Ruiz,8-111-2222,60001111,En bus,Cal,Sí,Cocina,,,Yappy,,,Ana.Ruiz@Example.com\n';
  const { columnas, filas } = leerInscripciones(csv);
  assertEquals(columnas, { nombre: 1, apellido: -1, correo: 13, cedula: 2, whatsapp: 3 });
  const v = validarImportacion(filas);
  assertEquals(v.validas, [{ nombre: 'Ana Ruiz', correo: 'ana.ruiz@example.com', cedula: '8-111-2222', whatsapp: '60001111' }]);
});

import { armarHojas } from './drive.ts';

Deno.test('arma las pestañas para la hoja de Drive', () => {
  const tipos = [{ id: 'servidor', nombre: 'Servidor', meta_centavos: 5900 }, { id: 'participante', nombre: 'Participante', meta_centavos: 6500 }];
  const P = (id: number, nombre: string, tipo: string, pagado: number, n: number) => ({
    id, nombre, correo: `${id}@x.com`, tipo, tipo_nombre: tipo === 'servidor' ? 'Servidor' : 'Participante',
    meta_centavos: tipo === 'servidor' ? 5900 : 6500, pagado_centavos: pagado, num_pagos: n,
    ultimo_pago: n ? '2026-10-21T15:00:00Z' : null, cedula: null, whatsapp: null,
  });
  const personas = [P(1, 'Zoe', 'participante', 6500, 2), P(2, 'Ana', 'participante', 0, 0), P(3, 'Luis', 'servidor', 3000, 1)];
  const pagos = [
    { id: 2, persona_id: 1, monto_centavos: 4500, fecha: '2026-10-21T15:00:00Z', estado_correo: 'enviado' },
    { id: 1, persona_id: 1, monto_centavos: 2000, fecha: '2026-10-20T15:00:00Z', estado_correo: 'error' },
    { id: 3, persona_id: 3, monto_centavos: 3000, fecha: '2026-10-21T16:00:00Z', estado_correo: 'enviado' },
  ];
  const [resumen, hojaPersonas, hojaPagos] = armarHojas(tipos, personas, pagos);
  assertEquals(resumen.filas.map((f) => f[0]), ['Servidores', 'Participantes', 'Total']);
  assertEquals(resumen.filas[2].slice(2, 6), [3, 189, 95, 94]);
  assertEquals(hojaPersonas.filas.map((f) => f[0]), ['Luis', 'Ana', 'Zoe']); // por rol y nombre
  assertEquals(hojaPersonas.filas[2].slice(9), ['Completo', 2, '2026-10-21T15:00:00Z']);
  assertEquals(hojaPagos.filas.map((f) => f[0]), ['000001', '000002', '000003']);
  assertEquals(hojaPagos.filas[0][6], 'No enviado');
  for (const h of [resumen, hojaPersonas, hojaPagos]) {
    assertEquals(h.formatos.length, h.encabezados.length);
    h.filas.forEach((f) => assertEquals(f.length, h.encabezados.length));
  }
});

Deno.test('una hoja vacía no es un error', () => {
  assertEquals(leerInscripciones('').filas, []);
  assertEquals(leerInscripciones(',,,\n,,,\n').filas, []);
  assertEquals(leerInscripciones('Fecha,Nombre completo,Correo electrónico\n').filas, []);
});

import { personasRetiradas } from './validar.ts';

Deno.test('quita a quienes ya no están en la hoja, salvo si tienen pagos', () => {
  const existentes = [
    { id: 1, correo: 'ana@x.com' }, { id: 2, correo: 'luis@x.com' }, { id: 3, correo: 'zoe@x.com' },
  ];
  const r = personasRetiradas(existentes, ['ANA@x.com ', ''], new Set([3]));
  assertEquals(r.borrar.map((p) => p.id), [2]);
  assertEquals(r.conservar.map((p) => p.id), [3]);
  assertEquals(personasRetiradas(existentes, [], new Set()).borrar.length, 3); // hoja vacía: se quitan todas
});
