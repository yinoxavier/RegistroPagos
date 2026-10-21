import { ORGANIZACION, formatearMonto, numeroRecibo, type Pago } from './recibo.ts';

const REMITENTE = Deno.env.get('EMAIL_REMITENTE') ?? 'Contact@yinosegura.dev';
const RESPONDER_A = Deno.env.get('EMAIL_RESPONDER_A') ?? REMITENTE;

function encodeBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Envía el recibo en PDF con Resend. Lanza error si falla. */
export async function enviarRecibo(pago: Pago, pdf: Uint8Array): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('Falta el secreto RESEND_API_KEY en Supabase.');

  const numero = numeroRecibo(pago.id);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${ORGANIZACION} <${REMITENTE}>`,
      to: [pago.correo],
      reply_to: RESPONDER_A,
      subject: `Recibo de pago N.º ${numero} - ${ORGANIZACION}`,
      html: `
        <p>Hola ${escapar(pago.nombre)},</p>
        <p>Hemos recibido tu pago por <strong>${formatearMonto(pago.monto_centavos)}</strong>.
           Adjuntamos tu recibo N.º ${numero}.</p>
        <p>¡Gracias!<br>${escapar(ORGANIZACION)}</p>`,
      attachments: [{ filename: `recibo-${numero}.pdf`, content: encodeBase64(pdf) }],
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Resend respondió ${res.status}: ${data?.message ?? 'error desconocido'}`);
  }
}
