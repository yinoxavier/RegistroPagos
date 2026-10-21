const filas = document.getElementById('filas');
const vacio = document.getElementById('vacio');
const formulario = document.getElementById('formulario');
const mensaje = document.getElementById('mensaje');

const monto = (centavos) =>
  '$' + (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ETIQUETAS = {
  enviado: 'Enviado',
  error: 'No enviado',
  omitido: 'Modo prueba',
  pendiente: 'Pendiente',
};

function celda(texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

function pintar(pagos) {
  filas.replaceChildren();
  vacio.hidden = pagos.length > 0;

  for (const p of pagos) {
    const tr = document.createElement('tr');
    const nombre = celda(p.nombre);
    const sub = document.createElement('small');
    sub.className = 'correo-movil';
    sub.textContent = p.correo;
    nombre.append(sub);
    tr.append(nombre, celda(p.correo, 'correo'), celda(monto(p.monto_centavos), 'num'));

    const td = document.createElement('td');
    const enlace = document.createElement('a');
    enlace.href = `/api/pagos/${p.id}/recibo.pdf`;
    enlace.target = '_blank';
    enlace.textContent = 'PDF';

    const estado = document.createElement('span');
    estado.className = `estado ${p.estado_correo}`;
    estado.textContent = ETIQUETAS[p.estado_correo] || p.estado_correo;
    if (p.error_correo) estado.title = p.error_correo;

    td.append(enlace, estado);

    if (p.estado_correo === 'error') {
      const reintentar = document.createElement('button');
      reintentar.type = 'button';
      reintentar.className = 'enlace';
      reintentar.textContent = 'Reenviar';
      reintentar.style.marginLeft = '6px';
      reintentar.onclick = async () => {
        reintentar.disabled = true;
        await fetch(`/api/pagos/${p.id}/reenviar`, { method: 'POST' });
        cargar();
      };
      td.append(reintentar);
    }
    tr.append(td);
    filas.append(tr);
  }
}

async function cargar() {
  const res = await fetch('/api/pagos');
  pintar(await res.json());
}

formulario.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = formulario.querySelector('button');
  boton.disabled = true;
  mensaje.className = 'mensaje';
  mensaje.textContent = 'Registrando…';

  try {
    const datos = Object.fromEntries(new FormData(formulario));
    const res = await fetch('/api/pagos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const r = await res.json();

    if (!res.ok) {
      mensaje.className = 'mensaje error';
      mensaje.textContent = (r.errores || ['No se pudo registrar.']).join(' ');
      return;
    }

    formulario.reset();
    if (r.estado_correo === 'enviado') {
      mensaje.className = 'mensaje ok';
      mensaje.textContent = `Pago registrado. Recibo enviado a ${r.correo}.`;
    } else if (r.estado_correo === 'error') {
      mensaje.className = 'mensaje error';
      mensaje.textContent = 'Pago registrado, pero el correo no se pudo enviar. Usa «Reenviar» en el listado.';
    } else {
      mensaje.className = 'mensaje ok';
      mensaje.textContent = 'Pago registrado (modo prueba: el correo no se envía).';
    }
    cargar();
  } catch {
    mensaje.className = 'mensaje error';
    mensaje.textContent = 'Error de conexión. Intenta de nuevo.';
  } finally {
    boton.disabled = false;
  }
});

cargar();
