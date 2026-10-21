# Registro de pagos · Comunidad Católica Shalom

Página para registrar pagos. Por cada pago se guarda **nombre, correo y monto**, se genera un **recibo en PDF** y se envía por correo desde `Juventudpanama@comshalom.com` (Outlook / Microsoft 365).

La página tiene dos secciones, detrás de un inicio de sesión:

- **Listado de personas y montos**: nombre, correo, monto, recibo PDF y estado del correo (con *Reenviar* si falló).
- **Registrar nuevo pago**: nombre, correo y monto.

## Cómo está armado

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `web/` | GitHub Pages | La página (HTML, CSS y JS) |
| `supabase/migrations/` | Supabase (Postgres) | Tabla `pagos`, solo lectura para usuarios con sesión |
| `supabase/functions/pagos/` | Supabase Edge Function | Registra el pago, genera el PDF y lo envía por Microsoft Graph |

GitHub Pages solo sirve archivos estáticos, por eso los datos y el envío del correo están en Supabase. Las claves de Microsoft quedan guardadas como secretos en Supabase, nunca en la página.

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
   | `MS_TENANT_ID` | Id. de directorio (paso 2) |
   | `MS_CLIENT_ID` | Id. de aplicación (paso 2) |
   | `MS_CLIENT_SECRET` | Secreto de cliente (paso 2) |
   | `EMAIL_REMITENTE` | `Juventudpanama@comshalom.com` |
   | `ORIGEN_PERMITIDO` | `https://yinoxavier.github.io` |

6. **Project Settings → API Keys**: copia la URL del proyecto y la **publishable key** en `web/config.js` y súbelo a GitHub.

### 2. Outlook (Microsoft 365)

Microsoft 365 ya no acepta envío SMTP con usuario y contraseña, por eso se usa **Microsoft Graph**. Lo hace un administrador del dominio `comshalom.com`:

1. <https://entra.microsoft.com> → **Aplicaciones** → **Registros de aplicaciones** → **Nuevo registro** (`Registro de pagos`).
2. Copia el **Id. de aplicación (cliente)** y el **Id. de directorio (inquilino)**.
3. **Certificados y secretos** → **Nuevo secreto de cliente** → copia el *Valor*.
4. **Permisos de API** → **Microsoft Graph** → **Permisos de aplicación** → `Mail.Send` → **Conceder consentimiento de administrador**.

> Recomendado: limitar la app para que solo pueda enviar desde `Juventudpanama@comshalom.com` (Exchange Online → *RBAC for Applications*).

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
