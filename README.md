# Registro de pagos · Comunidad Católica Shalom

Página para registrar pagos. Por cada pago se guarda **nombre, correo y monto**, se genera un **recibo en PDF** y se envía por correo desde una cuenta de **Gmail** (gratis, hasta 500 correos al día). También admite [Resend](https://resend.com) con el dominio `yinosegura.dev`.

La página tiene dos secciones, detrás de un inicio de sesión:

- **Listado de personas y montos**: nombre, correo, monto, recibo PDF y estado del correo (con *Reenviar* si falló).
- **Registrar nuevo pago**: nombre, correo y monto.

## Cómo está armado

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `web/` | GitHub Pages | La página (HTML, CSS y JS) |
| `supabase/migrations/` | Supabase (Postgres) | Tabla `pagos`, solo lectura para usuarios con sesión |
| `supabase/functions/pagos/` | Supabase Edge Function | Registra el pago, genera el PDF y lo envía (Gmail o Resend) |

GitHub Pages solo sirve archivos estáticos, por eso los datos y el envío del correo están en Supabase. Las claves de correo quedan guardadas como secretos en Supabase, nunca en la página.

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
   | `GMAIL_USER` | La cuenta de Gmail que envía (paso 2) |
   | `GMAIL_APP_PASSWORD` | Su contraseña de aplicación de 16 letras (paso 2) |
   | `RESEND_API_KEY` | Solo si usas Resend en lugar de Gmail |
   | `ORIGEN_PERMITIDO` | Opcional. Por defecto `https://yinoxavier.github.io` |

   Si están los dos secretos de Gmail se usa Gmail; si no, Resend.

6. **Project Settings → API Keys**: copia la URL del proyecto y la **publishable key** en `web/config.js` y súbelo a GitHub.

### 2. Correo de envío con Gmail (gratis)

1. Crea una cuenta nueva en <https://accounts.google.com/signup> (por ejemplo `recibos.shalom@gmail.com`).
2. **Cuenta de Google → Seguridad → Verificación en dos pasos** → actívala.
3. Entra a <https://myaccount.google.com/apppasswords>, escribe un nombre (`Registro de pagos`) y pulsa **Crear**. Copia la contraseña de 16 letras.
4. Guarda `GMAIL_USER` y `GMAIL_APP_PASSWORD` como secretos en Supabase.

Límite de Gmail: unos 500 correos al día. La función usa el puerto 465, porque Supabase bloquea el 25 y el 587.

#### Alternativa: Resend con tu dominio

1. Cuenta gratis en <https://resend.com> (3,000 correos al mes, 100 al día).
2. **Domains → Add Domain** → `yinosegura.dev`, copia los registros DNS en tu dominio y pulsa **Verify**.
3. **API Keys → Create API Key** → guárdala como secreto `RESEND_API_KEY` (y `EMAIL_REMITENTE`, por defecto `Contact@yinosegura.dev`).

### 3. GitHub Pages

Cada cambio en `web/` se publica solo con el workflow `.github/workflows/pages.yml` (Settings → Pages → Source: **GitHub Actions**).

## Pruebas

```bash
deno test --allow-env --allow-write --allow-read --allow-sys supabase/functions/pagos
```

## Función `pagos`

`POST /functions/v1/pagos` con la sesión del usuario en `Authorization`:

| Cuerpo | Resultado |
|---|---|
| `{ "accion": "registrar", "nombre", "correo", "monto" }` | Guarda, genera el PDF y lo envía |
| `{ "accion": "reenviar", "id" }` | Reintenta el correo |
| `{ "accion": "recibo", "id" }` | Devuelve el PDF |
