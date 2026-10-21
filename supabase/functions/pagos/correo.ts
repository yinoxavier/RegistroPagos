import { ORGANIZACION, formatearMonto, numeroRecibo, type Pago } from './recibo.ts';

function encodeBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

const REMITENTE = Deno.env.get('EMAIL_REMITENTE') ?? 'Juventudpanama@comshalom.com';

let tokenCache = { valor: '', expira: 0 };

/** Token de aplicación de Microsoft Graph (flujo client credentials). */
async function obtenerToken(): Promise<string> {
  if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;

  const tenant = Deno.env.get('MS_TENANT_ID');
  const clientId = Deno.env.get('MS_CLIENT_ID');
  const secret = Deno.env.get('MS_CLIENT_SECRET');
  if (!tenant || !clientId || !secret) {
    throw new Error('Faltan los secretos MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET en Supabase.');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`No se pudo autenticar con Microsoft: ${data.error_description ?? res.status}`);
  }
  tokenCache = { valor: data.access_token, expira: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.valor;
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Envía el recibo en PDF por Outlook (Microsoft Graph). Lanza error si falla. */
export async function enviarRecibo(pago: Pago, pdf: Uint8Array): Promise<void> {
  const token = await obtenerToken();
  const numero = numeroRecibo(pago.id);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(REMITENTE)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `Recibo de pago N.º ${numero} - ${ORGANIZACION}`,
          body: {
            contentType: 'HTML',
            content: `
              <p>Hola ${escapar(pago.nombre)},</p>
              <p>Hemos recibido tu pago por <strong>${formatearMonto(pago.monto_centavos)}</strong>.
                 Adjuntamos tu recibo N.º ${numero}.</p>
              <p>¡Gracias!<br>${escapar(ORGANIZACION)}</p>`,
          },
          toRecipients: [{ emailAddress: { address: pago.correo, name: pago.nombre } }],
          attachments: [{
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: `recibo-${numero}.pdf`,
            contentType: 'application/pdf',
            contentBytes: encodeBase64(pdf),
          }],
        },
        saveToSentItems: true,
      }),
    },
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Microsoft Graph respondió ${res.status}: ${data?.error?.message ?? 'error desconocido'}`);
  }
}
