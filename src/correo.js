const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { numeroRecibo, formatearMonto } = require('./formato');

let tokenCache = { valor: null, expira: 0 };

/** Token de aplicación para Microsoft Graph (flujo client credentials). */
async function obtenerToken() {
  if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;

  const { tenantId, clientId, clientSecret } = config.graph;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Faltan MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET en el archivo .env');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`No se pudo autenticar con Microsoft: ${data.error_description || res.status}`);

  tokenCache = { valor: data.access_token, expira: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.valor;
}

function cuerpoHtml(pago) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  return `
    <p>Hola ${esc(pago.nombre)},</p>
    <p>Hemos recibido tu pago por <strong>${formatearMonto(pago.monto_centavos)}</strong>.
       Adjuntamos tu recibo N.º ${numeroRecibo(pago.id)}.</p>
    <p>¡Gracias!<br>${esc(config.organizacion)}</p>`;
}

async function enviarConGraph(pago, pdf) {
  const token = await obtenerToken();
  const remitente = encodeURIComponent(config.emailRemitente);

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${remitente}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: `Recibo de pago N.º ${numeroRecibo(pago.id)} - ${config.organizacion}`,
        body: { contentType: 'HTML', content: cuerpoHtml(pago) },
        toRecipients: [{ emailAddress: { address: pago.correo, name: pago.nombre } }],
        attachments: [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `recibo-${numeroRecibo(pago.id)}.pdf`,
          contentType: 'application/pdf',
          contentBytes: pdf.toString('base64'),
        }],
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Microsoft Graph respondió ${res.status}: ${data.error?.message || 'error desconocido'}`);
  }
}

/** Modo prueba: no envía nada, guarda el PDF en data/recibos. */
function guardarLocal(pago, pdf) {
  const dir = path.join(path.dirname(config.dbPath), 'recibos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `recibo-${numeroRecibo(pago.id)}.pdf`), pdf);
}

/**
 * Envía el recibo. Devuelve 'enviado' u 'omitido' (modo prueba);
 * lanza un error si el envío falla.
 */
async function enviarRecibo(pago, pdf) {
  if (config.emailProveedor === 'graph') {
    await enviarConGraph(pago, pdf);
    return 'enviado';
  }
  guardarLocal(pago, pdf);
  return 'omitido';
}

module.exports = { enviarRecibo };
