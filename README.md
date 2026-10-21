# Registro de pagos · Comunidad Católica Shalom

Página para registrar pagos. Por cada pago se guarda **nombre, correo y monto**, se genera un **recibo en PDF** y se envía por correo desde `Contact@yinosegura.dev` usando [Resend](https://resend.com).

La página tiene dos secciones, detrás de un inicio de sesión:

- **Listado de personas y montos**: nombre, correo, monto, recibo PDF y estado del correo (con *Reenviar* si falló).
- **Registrar nuevo pago**: nombre, correo y monto.

## Cómo está armado

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `web/` | GitHub Pages | La página (HTML, CSS y JS) |
| `supabase/migrations/` | Supabase (Postgres) | Tabla `pagos`, solo lectura para usuarios con sesión |
| `supabase/functions/pagos/` | Supabase Edge Function | Registra el pago, genera el PDF y lo envía con Resend |

GitHub Pages solo sirve archivos estáticos, por eso los datos y el envío del correo están en Supabase. La clave de Resend queda guardada como secreto en Supabase, nunca en la página.

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → pega el contenido de `supabase/migrations/20261021000000_pagos.sql` → **Run**.
3. **Authentication**:
   - Desactiva **Allow new users to sign up** (nadie puede registrarse solo).
   - En **Users** → **Add user** crea las cuentas del equipo (correo y contraseña, marcando *Auto Confirm*).
4. **Edge Functions** → crea la función **`pagos`** con los 4 archivos de `supabase/functions/pagos/` (`index.ts`, `recibo.ts`, `correo.ts`, `validar.ts`) y **desactiva "Verify JWT"**: la función comprueba la sesión por su cuenta.
   Con la CLI: `supabase functions deploy pagos --no-verify-jwt --project-ref TU_REF`
5. **Edge Functions → Secrets**, agrega:

   | Secreto | Valor |
   |---|---|
   | `RESEND_API_KEY` | Clave de API de Resend (paso 2) |
   | `EMAIL_REMITENTE` | Opcional. Por defecto `Contact@yinosegura.dev` |
   | `ORIGEN_PERMITIDO` | Opcional. Por defecto `https://yinoxavier.github.io` |

6. **Project Settings → API Keys**: copia la URL del proyecto y la **publishable key** en `web/config.js` y súbelo a GitHub.

### 2. Resend (envío de correo)

1. Crea una cuenta gratis en <https://resend.com> (3,000 correos al mes, 100 al día).
2. **Domains → Add Domain** → `yinosegura.dev`.
3. Copia los registros DNS que muestra Resend (DKIM, SPF/MX del subdominio `send` y opcionalmente DMARC) en el panel DNS de tu dominio y pulsa **Verify**. Estos registros no afectan el correo que ya recibes en `Contact@yinosegura.dev`.
4. **API Keys → Create API Key** con permiso *Sending access* → guárdala como secreto `RESEND_API_KEY` en Supabase.

### 3. GitHub Pages

Cada cambio en `web/` se publica solo con el workflow `.github/workflows/pages.yml` (Settings → Pages → Source: **GitHub Actions**).

## Pruebas

```bash
deno test --allow-env --allow-write supabase/functions/pagos
```

## Función `pagos`

`POST /functions/v1/pagos` con la sesión del usuario en `Authorization`:

| Cuerpo | Resultado |
|---|---|
| `{ "accion": "registrar", "nombre", "correo", "monto" }` | Guarda, genera el PDF y lo envía |
| `{ "accion": "reenviar", "id" }` | Reintenta el correo |
| `{ "accion": "recibo", "id" }` | Devuelve el PDF |
