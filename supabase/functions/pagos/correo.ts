import nodemailer from 'npm:nodemailer@6.10.1';
import { ORGANIZACION, formatearMonto, numeroRecibo, saldo, type Avance, type Pago } from './recibo.ts';

// Proveedor de correo (se usa el primero que esté configurado):
//   1. Gmail:  GMAIL_USER + GMAIL_APP_PASSWORD (contraseña de aplicación de Google)
//   2. Resend: RESEND_API_KEY (+ EMAIL_REMITENTE con dominio verificado)

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Mensaje {
  para: string;
  asunto: string;
  html: string;
  adjunto: { nombre: string; contenido: Uint8Array };
}

export function armarMensaje(pago: Pago, pdf: Uint8Array, avance?: Avance): Mensaje {
  const numero = numeroRecibo(pago.id);
  let resumen = '';
  if (avance) {
    const pendiente = saldo(avance);
    resumen = pendiente === 0
      ? `<p>Con este pago completaste tu aporte de ${formatearMonto(avance.metaCentavos)}. ¡Muchas gracias!</p>`
      : `<p>Llevas abonado ${formatearMonto(avance.acumuladoCentavos)} de ${formatearMonto(avance.metaCentavos)}.
           Saldo pendiente: <strong>${formatearMonto(pendiente)}</strong>.</p>`;
  }
  return {
    para: pago.correo,
    asunto: `Recibo de pago N.º ${numero} - ${ORGANIZACION}`,
    html: `
      <p>Hola ${escapar(pago.nombre)},</p>
      <p>Hemos recibido tu pago por <strong>${formatearMonto(pago.monto_centavos)}</strong>.
         Adjuntamos tu recibo N.º ${numero}.</p>
      ${resumen}
      <p>¡Gracias!<br>${escapar(ORGANIZACION)}</p>`,
    adjunto: { nombre: `recibo-${numero}.pdf`, contenido: pdf },
  };
}

/** Opciones de nodemailer para Gmail (puerto 465: Supabase bloquea 25 y 587). */
export function opcionesGmail(usuario: string, clave: string) {
  return {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: usuario, pass: clave.replace(/\s+/g, '') },
  };
}

export function datosNodemailer(m: Mensaje, remitente: string) {
  return {
    from: { name: ORGANIZACION, address: remitente },
    to: m.para,
    subject: m.asunto,
    html: m.html,
    attachments: [{ filename: m.adjunto.nombre, content: m.adjunto.contenido, contentType: 'application/pdf' }],
  };
}

async function enviarConGmail(m: Mensaje, usuario: string, clave: string) {
  const transporte = nodemailer.createTransport(opcionesGmail(usuario, clave));
  try {
    await transporte.sendMail(datosNodemailer(m, usuario));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Invalid login|BadCredentials|535/i.test(msg)) {
      throw new Error('Gmail rechazó el acceso: revisa GMAIL_USER y la contraseña de aplicación.');
    }
    throw new Error(`Gmail: ${msg}`);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

async function enviarConResend(m: Mensaje, apiKey: string) {
  const remitente = Deno.env.get('EMAIL_REMITENTE') ?? 'Contact@yinosegura.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${ORGANIZACION} <${remitente}>`,
      to: [m.para],
      reply_to: Deno.env.get('EMAIL_RESPONDER_A') ?? remitente,
      subject: m.asunto,
      html: m.html,
      attachments: [{ filename: m.adjunto.nombre, content: encodeBase64(m.adjunto.contenido) }],
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Resend respondió ${res.status}: ${data?.message ?? 'error desconocido'}`);
  }
}

/** Envía el recibo en PDF. Lanza error si falla o si no hay proveedor configurado. */
export async function enviarRecibo(pago: Pago, pdf: Uint8Array, avance?: Avance): Promise<void> {
  const mensaje = armarMensaje(pago, pdf, avance);

  const gmailUser = Deno.env.get('GMAIL_USER');
  const gmailClave = Deno.env.get('GMAIL_APP_PASSWORD');
  if (gmailUser && gmailClave) return await enviarConGmail(mensaje, gmailUser, gmailClave);

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) return await enviarConResend(mensaje, resendKey);

  throw new Error('No hay correo configurado: agrega GMAIL_USER y GMAIL_APP_PASSWORD en Supabase.');
}
