# Registro de pagos · Comunidad Católica Shalom

Página para registrar los aportes de **Servidores (meta $59)** y **Participantes (meta $65)**. Las personas se cargan desde las hojas de Google Sheets de inscripción; cada pago se suma a su persona hasta llegar a la meta, y se envía un **recibo en PDF** con el total abonado y el saldo pendiente.

La página (detrás de un inicio de sesión) tiene tres pestañas:

- **Nuevo pago**: buscas a la persona por nombre, correo o cédula, ves cuánto le falta y registras el monto. No permite pasarse de la meta.
- **Listado**: todas las personas con su rol, correo y barra de avance; filtros por rol y estado; historial de pagos con PDF y reenvío; botón **Sincronizar inscripciones**, alta manual y enlaces de las hojas.
- **Resumen**: recaudado, por cobrar, personas y pagos; avance por rol (completos, abonando, sin pagos); últimos pagos; y **Abrir hoja en Drive**.

## Hoja de Google Drive (se actualiza sola)

Cada vez que se registra un pago, se reenvía un recibo, se agrega una persona o la sincronización trae cambios, la función reescribe una hoja de Google Sheets en Drive con tres pestañas:

- **Resumen**: por rol y total (personas, meta, recaudado, por cobrar, avance, completos, abonando, sin pagos).
- **Personas**: nombre, rol, correo, cédula, WhatsApp, meta, pagado, pendiente, avance, estado, n.º de pagos y último pago.
- **Pagos**: recibo, fecha, persona, rol, correo, monto y si se envió el recibo.

Instalación (una vez):

1. Crea una hoja de Google Sheets en Drive.
2. **Extensiones → Apps Script**, borra lo que haya y pega [`apps-script/Codigo.gs`](apps-script/Codigo.gs). En `TOKEN` pon la clave guardada en Supabase (`select valor from ajustes where clave = 'drive_token'`).
3. **Implementar → Nueva implementación → Aplicación web**: *Ejecutar como*: Yo · *Quién tiene acceso*: Cualquier usuario. Autoriza el acceso.
4. Copia la URL de la aplicación web (termina en `/exec`) y pégala en la página: **Resumen → Conectar hoja de Google Drive**.

Cada envío reescribe la hoja completa, así que si alguno falla el siguiente la deja al día. También se puede forzar con **Actualizar hoja** en el Resumen.

## Inscripciones desde Google Sheets

| Tipo | Meta | Hoja |
|---|---|---|
| Servidor | $59 | [Servidores](https://docs.google.com/spreadsheets/d/1IA87WD4Dlwt1LqdhSQDtIIXYXm0jZR5tNNgBXUyA8oI/edit) |
| Participante | $65 | [Participantes](https://docs.google.com/spreadsheets/d/1bLsO7VhBll8oDmF2-H99thVayCqUTsa15P79t_hTUfY/edit) |

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
| `supabase/functions/pagos/` | Supabase Edge Function | Registra el pago, genera el PDF, lo envía (Gmail o Resend) y actualiza la hoja de Drive |
| `apps-script/Codigo.gs` | Google Apps Script | Recibe los datos y reescribe la hoja de Google Drive |

GitHub Pages solo sirve archivos estáticos, por eso los datos y el envío del correo están en Supabase. Las claves de correo quedan guardadas como secretos en Supabase, nunca en la página.

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → ejecuta en orden los archivos de `supabase/migrations/`.
3. **Authentication**:
   - Desactiva **Allow new users to sign up** (nadie puede registrarse solo).
   - En **Users** → **Add user** crea las cuentas del equipo (correo y contraseña, marcando *Auto Confirm*).
4. **Edge Functions** → crea la función **`pagos`** con los 6 archivos de `supabase/functions/pagos/` (`index.ts`, `recibo.ts`, `correo.ts`, `validar.ts`, `hoja.ts`, `drive.ts`) y **desactiva "Verify JWT"**: la función comprueba la sesión por su cuenta.
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
| `{ "accion": "actualizar_drive" }` | Reescribe la hoja de Google Drive |
| `{ "accion": "configurar_drive", "enlace" }` | Guarda la URL del Apps Script y escribe la hoja |
