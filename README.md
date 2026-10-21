# Registro de pagos · Comunidad Católica Shalom

Página sencilla para registrar pagos. Por cada pago se guarda **nombre, correo y monto**, se genera un **recibo en PDF** y se envía por correo desde `Juventudpanama@comshalom.com` (Outlook / Microsoft 365).

La página tiene solo dos secciones:

- **Listado de personas y montos**: nombre, correo, monto, enlace al PDF y estado del correo (con botón *Reenviar* si falló).
- **Registrar nuevo pago**: formulario con nombre, correo y monto.

## Tecnología

- Node.js 22.13 o superior + Express
- SQLite integrado en Node (`node:sqlite`), sin instalar base de datos
- PDFKit para el recibo
- Microsoft Graph para enviar el correo con Outlook

## Instalación local

```bash
npm install
cp .env.example .env    # edita los valores
npm start               # http://localhost:3000
```

Con `EMAIL_PROVEEDOR=ninguno` (modo prueba) no se envían correos: los PDF se guardan en `data/recibos/`.

## Configurar el envío con Outlook

Desde el 30 de abril de 2026 Microsoft 365 ya no acepta envío SMTP con usuario y contraseña, por eso la app envía mediante **Microsoft Graph**. Lo configura una persona con permisos de administrador del dominio `comshalom.com`:

1. Entra a <https://entra.microsoft.com> → **Aplicaciones** → **Registros de aplicaciones** → **Nuevo registro**. Nombre: `Registro de pagos`.
2. Copia el **Id. de aplicación (cliente)** → `MS_CLIENT_ID` y el **Id. de directorio (inquilino)** → `MS_TENANT_ID`.
3. **Certificados y secretos** → **Nuevo secreto de cliente** → copia el *Valor* → `MS_CLIENT_SECRET`.
4. **Permisos de API** → **Agregar un permiso** → **Microsoft Graph** → **Permisos de aplicación** → `Mail.Send` → **Conceder consentimiento de administrador**.
5. En `.env` pon `EMAIL_PROVEEDOR=graph`.

> Recomendado: limitar la app para que solo pueda enviar desde `Juventudpanama@comshalom.com` (Exchange Online → *RBAC for Applications* o *Application Access Policy*).

## Publicarlo

Cualquier servicio que ejecute Node sirve (Railway, Render, un VPS). La base de datos es el archivo `data/pagos.db`, así que el servicio debe tener **disco persistente** (por ejemplo, un *volume* en Railway o un *disk* en Render) y `DB_PATH` apuntando a él. Define `ADMIN_USER` y `ADMIN_PASSWORD` para que la página pida clave.

## Estructura

```
src/
  server.js    rutas y validación
  db.js        tabla de pagos (SQLite)
  recibo.js    genera el PDF
  correo.js    envío por Microsoft Graph o modo prueba
  formato.js   número de recibo, montos y fechas
  config.js    variables de entorno
public/
  index.html   la página
  app.js       listado y formulario
  estilos.css
```

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/pagos` | Listado |
| POST | `/api/pagos` | Registrar `{ nombre, correo, monto }` |
| POST | `/api/pagos/:id/reenviar` | Reintentar el correo |
| GET | `/api/pagos/:id/recibo.pdf` | Ver el recibo |
