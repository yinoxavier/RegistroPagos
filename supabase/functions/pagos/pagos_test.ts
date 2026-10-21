// Pruebas locales: deno test --allow-env --allow-write --allow-read --allow-sys supabase/functions/pagos
import { deepStrictEqual as assertEquals } from 'node:assert';
import { validarPago } from './validar.ts';
import { formatearMonto, generarRecibo, numeroRecibo } from './recibo.ts';
import { armarMensaje, datosNodemailer } from './correo.ts';
import nodemailer from 'npm:nodemailer@6.10.1';

Deno.test('arma el correo con el PDF adjunto (formato Gmail/SMTP)', async () => {
  const pdf = await generarRecibo({
    id: 7, nombre: 'José <Pérez>', correo: 'jose@example.com',
    monto_centavos: 1000, fecha: '2026-10-21T05:55:44Z',
  });
  const m = armarMensaje({
    id: 7, nombre: 'José <Pérez>', correo: 'jose@example.com',
    monto_centavos: 1000, fecha: '2026-10-21T05:55:44Z',
  }, pdf);
  assertEquals(m.html.includes('José &lt;Pérez&gt;'), true);

  const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const info = await t.sendMail(datosNodemailer(m, 'recibos@gmail.com'));
  const raw = info.message.toString();
  assertEquals(raw.includes('filename=recibo-000007.pdf'), true);
  assertEquals(raw.includes('Content-Type: application/pdf'), true);
  assertEquals(/From: =\?UTF-8\?.*<recibos@gmail\.com>/.test(raw), true);
  const salida = Deno.env.get('CORREO_SALIDA');
  if (salida) await Deno.writeTextFile(salida, raw);
});

Deno.test('valida y normaliza un pago correcto', () => {
  const r = validarPago({ nombre: '  María   José ', correo: 'Maria@Example.com', monto: '25,5' });
  assertEquals(r.errores, []);
  assertEquals(r.datos, { nombre: 'María José', correo: 'maria@example.com', montoCentavos: 2550 });
});

Deno.test('rechaza datos inválidos', () => {
  assertEquals(validarPago({ nombre: 'x', correo: 'malo', monto: '-3' }).errores.length, 3);
  assertEquals(validarPago({ nombre: 'Ana Ruiz', correo: 'a@b.co', monto: '0' }).errores.length, 1);
  assertEquals(validarPago({ nombre: 'Ana Ruiz', correo: 'a@b.co', monto: '1.234' }).errores.length, 1);
});

Deno.test('formatea número de recibo y monto', () => {
  assertEquals(numeroRecibo(42), '000042');
  assertEquals(formatearMonto(125000), '$1,250.00 USD');
});

Deno.test('genera un PDF con tildes y ñ', async () => {
  const pdf = await generarRecibo({
    id: 2, nombre: 'Juan Ñúñez', correo: 'juan@example.com',
    monto_centavos: 125000, fecha: '2026-10-21T05:55:44Z',
  });
  assertEquals(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-');
  const conEmoji = await generarRecibo({
    id: 3, nombre: 'Ana 🙏 Łukasz', correo: 'ana@example.com',
    monto_centavos: 500, fecha: '2026-10-21T05:55:44Z',
  });
  assertEquals(conEmoji.length > 0, true);
  const salida = Deno.env.get('RECIBO_SALIDA');
  if (salida) await Deno.writeFile(salida, pdf);
});
