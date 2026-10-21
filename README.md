# Registro de pagos · Comunidad Católica Shalom

Página para registrar los aportes de **Servidores (meta $59)** y **Participantes (meta $65)**. Las personas se cargan desde las hojas de Google Sheets de inscripción; cada pago se suma a su persona hasta llegar a la meta, y se envía un **recibo en PDF** con el total abonado y el saldo pendiente.

La página (detrás de un inicio de sesión) tiene:

- **Nuevo pago** (arriba): buscas a la persona por nombre, correo o cédula, ves cuánto le falta y registras el monto. No permite pasarse de la meta.
- **Personas registradas** (arriba): conteo por tipo, botón **Sincronizar inscripciones**, alta manual y enlaces de las hojas.
- **Listado de personas**: barra de avance de cada persona, total recaudado, filtros por tipo y estado, e historial de pagos con su PDF y estado del correo.

## Inscripciones desde Google Sheets

| Tipo | Meta | Hoja |
|---|---|---|
| Servidor | $59 | [Servidores](https://docs.google.com/spreadsheets/d/1kzidEepJiatmbaPzvl_vYDb9YV0mQ4D07ePCk2SoR-4/edit) |
| Participante | $65 | [Participantes](https://docs.google.com/spreadsheets/d/1ziK2nA2ljo0nfoHGnXSB4FmiyEHpPuynnv6QgrXkNuU/edit) |

- Las hojas deben estar compartidas como **"Cualquier persona con el enlace"** (lector).
- Se reconocen las columnas por su título: *Nombre completo*, *Correo electrónico*, *Cédula*, *WhatsApp*.
- Cada persona se identifica por su **correo**; las filas sin correo no se cargan y la página lo avisa.
- Al sincronizar de nuevo se agregan las personas nuevas y se actualizan nombre, cédula y WhatsApp.
- La página sincroniza sola al entrar si pasaron más de 15 minutos.
- Las metas están en la tabla `tipos` (cambiarlas ahí las cambia para todos).

## Cómo está armado

| Parte | Dónde vive | Qué hace |
|---|---|---|
| `web/` | GitHub Pages | La página (HTML, CSS y JS) |
| `supabase/migrations/` | Supabase (Postgres) | Tablas `tipos`, `personas`, `pagos` y vista `personas_resumen`; solo lectura para usuarios con sesión y tope por meta en la base |
| `supabase/functions/pagos/` | Supabase Edge Function | Registra el pago, genera el PDF y lo envía (Gmail o Resend) |

GitHub Pages solo sirve archivos estáticos, por eso los datos y el envío del correo están en Supabase. Las claves de correo quedan guardadas como secretos en Supabase, nunca en la página.

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → ejecuta en orden los archivos de `supabase/migrations/`.
3. **Authentication**:
   - Desactiva **Allow new users to sign up** (nadie puede registrarse solo).
   - En **Users** → **Add user** crea las cuentas del equipo (correo y contraseña, marcando *Auto Confirm*).
4. **Edge Functions** → crea la función **`pagos`** con los 5 archivos de `supabase/functions/pagos/` (`index.ts`, `recibo.ts`, `correo.ts`, `validar.ts`, `hoja.ts`) y **desactiva "Verify JWT"**: la función comprueba la sesión por su cuenta.
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
| `{ "accion": "registrar", "persona_id", "monto" }` | Suma el pago a la persona (sin pasar la meta), genera el PDF y lo envía |
| `{ "accion": "sincronizar" }` | Lee las hojas de inscripción y crea/actualiza personas |
| `{ "accion": "crear_persona", "nombre", "correo", "tipo" }` | Alta manual |
| `{ "accion": "configurar_hoja", "tipo", "enlace" }` | Cambia la hoja de un tipo |
| `{ "accion": "reenviar", "id" }` | Reintenta el correo |
| `{ "accion": "recibo", "id" }` | Devuelve el PDF |
