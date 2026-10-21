const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { generarRecibo } = require('./recibo');
const { enviarRecibo } = require('./correo');
const { numeroRecibo } = require('./formato');

const app = express();
app.use(express.json());

// Protección con usuario y contraseña si están definidos en .env
if (config.adminUser && config.adminPassword) {
  const iguales = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  app.use((req, res, next) => {
    const [tipo, valor] = (req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [user, ...resto] = Buffer.from(valor, 'base64').toString().split(':');
      if (iguales(user, config.adminUser) && iguales(resto.join(':'), config.adminPassword)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Registro de pagos"').status(401).send('Acceso restringido');
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validar(body) {
  const nombre = String(body.nombre || '').trim();
  const correo = String(body.correo || '').trim().toLowerCase();
  const montoTexto = String(body.monto ?? '').trim().replace(',', '.');
  const errores = [];

  if (nombre.length < 2 || nombre.length > 120) errores.push('Escribe el nombre completo.');
  if (!CORREO_RE.test(correo) || correo.length > 200) errores.push('El correo no es válido.');
  if (!/^\d+(\.\d{1,2})?$/.test(montoTexto)) errores.push('El monto debe ser un número con hasta 2 decimales.');

  const montoCentavos = Math.round(Number(montoTexto) * 100);
  if (!errores.length && (montoCentavos <= 0 || montoCentavos > 100_000_000)) {
    errores.push('El monto debe ser mayor que 0.');
  }
  return { errores, datos: { nombre, correo, montoCentavos } };
}

async function procesarCorreo(pago) {
  try {
    const pdf = await generarRecibo(pago);
    const estado = await enviarRecibo(pago, pdf);
    db.actualizarEstadoCorreo(pago.id, estado);
  } catch (err) {
    console.error(`Recibo ${pago.id}:`, err.message);
    db.actualizarEstadoCorreo(pago.id, 'error', err.message);
  }
  return db.obtenerPago(pago.id);
}

app.get('/api/pagos', (req, res) => {
  res.json(db.listarPagos());
});

app.post('/api/pagos', async (req, res) => {
  const { errores, datos } = validar(req.body || {});
  if (errores.length) return res.status(400).json({ errores });

  const pago = db.crearPago(datos);
  res.status(201).json(await procesarCorreo(pago));
});

app.post('/api/pagos/:id/reenviar', async (req, res) => {
  const pago = db.obtenerPago(Number(req.params.id));
  if (!pago) return res.status(404).json({ errores: ['Pago no encontrado.'] });
  res.json(await procesarCorreo(pago));
});

app.get('/api/pagos/:id/recibo.pdf', async (req, res) => {
  const pago = db.obtenerPago(Number(req.params.id));
  if (!pago) return res.status(404).send('Pago no encontrado');
  const pdf = await generarRecibo(pago);
  res.type('application/pdf')
    .set('Content-Disposition', `inline; filename="recibo-${numeroRecibo(pago.id)}.pdf"`)
    .send(pdf);
});

app.listen(config.port, () => {
  console.log(`Registro de pagos en http://localhost:${config.port}`);
  console.log(`Envío de correo: ${config.emailProveedor === 'graph' ? 'Outlook (Microsoft Graph)' : 'modo prueba (no envía)'}`);
});
