require('dotenv').config({ quiet: true });
const path = require('node:path');

const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pagos.db'),

  // Datos que aparecen en el recibo
  organizacion: process.env.ORG_NOMBRE || 'Comunidad Católica Shalom',
  zonaHoraria: process.env.ZONA_HORARIA || 'America/Panama',
  moneda: process.env.MONEDA || 'USD',

  // Acceso a la página (opcional pero recomendado en producción)
  adminUser: process.env.ADMIN_USER || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',

  // Envío de correo
  // graph  -> Outlook / Microsoft 365 vía Microsoft Graph (recomendado)
  // ninguno -> no envía; guarda el PDF en data/recibos (modo prueba)
  emailProveedor: (process.env.EMAIL_PROVEEDOR || 'ninguno').toLowerCase(),
  emailRemitente: process.env.EMAIL_REMITENTE || 'Juventudpanama@comshalom.com',
  graph: {
    tenantId: process.env.MS_TENANT_ID || '',
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
  },
};

module.exports = config;
