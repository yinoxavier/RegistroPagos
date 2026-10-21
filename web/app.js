import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const vistaLogin = $('login');
const vistaApp = $('app');
const filas = $('filas');
const vacio = $('vacio');
const formulario = $('formulario');
const mensaje = $('mensaje');

if (SUPABASE_URL.includes('TU-PROYECTO')) {
  document.body.innerHTML =
    '<p style="padding:24px">Falta configurar <code>web/config.js</code> con los datos de Supabase.</p>';
  throw new Error('Supabase sin configurar');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- Utilidades ---------- */

const monto = (centavos) =>
  '$' + (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ETIQUETAS = { enviado: 'Enviado', error: 'No enviado', pendiente: 'Pendiente' };

function avisar(el, texto, tipo = '') {
  el.className = `mensaje ${tipo}`;
  el.textContent = texto;
}

/** Llama a la función "pagos" de Supabase con la sesión actual. */
async function llamarFuncion(cuerpo) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Tu sesión expiró. Vuelve a ingresar.');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/pagos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (res.headers.get('Content-Type')?.includes('application/pdf')) return res.blob();
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((datos.errores || ['No se pudo completar la operación.']).join(' '));
  return datos;
}

/* ---------- Listado ---------- */

function celda(texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

async function abrirRecibo(id) {
  // La ventana se abre antes de esperar, para que el navegador no la bloquee
  const ventana = window.open('', '_blank');
  if (ventana) ventana.document.write('<p style="font-family:sans-serif">Generando recibo…</p>');
  try {
    const pdf = await llamarFuncion({ accion: 'recibo', id });
    const url = URL.createObjectURL(pdf);
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
  } catch (e) {
    ventana?.close();
    alert(e.message);
  }
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
    enlace.href = '#';
    enlace.textContent = 'PDF';
    enlace.onclick = (e) => { e.preventDefault(); abrirRecibo(p.id); };

    const estado = document.createElement('span');
    estado.className = `estado ${p.estado_correo}`;
    estado.textContent = ETIQUETAS[p.estado_correo] || p.estado_correo;
    if (p.error_correo) estado.title = p.error_correo;
    td.append(enlace, estado);

    if (p.estado_correo !== 'enviado') {
      const reenviar = document.createElement('button');
      reenviar.type = 'button';
      reenviar.className = 'enlace';
      reenviar.textContent = 'Reenviar';
      reenviar.style.marginLeft = '6px';
      reenviar.onclick = async () => {
        reenviar.disabled = true;
        reenviar.textContent = 'Enviando…';
        try { await llamarFuncion({ accion: 'reenviar', id: p.id }); }
        catch (e) { alert(e.message); }
        cargar();
      };
      td.append(reenviar);
    }

    tr.append(td);
    filas.append(tr);
  }
}

async function cargar() {
  const { data, error } = await supabase
    .from('pagos')
    .select('id, nombre, correo, monto_centavos, estado_correo, error_correo')
    .order('id', { ascending: false });
  if (error) { avisar(mensaje, 'No se pudo cargar el listado.', 'error'); return; }
  pintar(data);
}

/* ---------- Registro ---------- */

formulario.addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = formulario.querySelector('button');
  boton.disabled = true;
  avisar(mensaje, 'Registrando y enviando recibo…');

  try {
    const datos = Object.fromEntries(new FormData(formulario));
    const pago = await llamarFuncion({ accion: 'registrar', ...datos });
    formulario.reset();
    if (pago.estado_correo === 'enviado') {
      avisar(mensaje, `Pago registrado. Recibo enviado a ${pago.correo}.`, 'ok');
    } else {
      avisar(mensaje, 'Pago registrado, pero el correo no se pudo enviar. Usa «Reenviar» en el listado.', 'error');
    }
    cargar();
  } catch (err) {
    avisar(mensaje, err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

/* ---------- Sesión ---------- */

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = e.target.querySelector('button');
  boton.disabled = true;
  const { email, password } = Object.fromEntries(new FormData(e.target));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  boton.disabled = false;
  if (error) avisar($('mensaje-login'), 'Correo o contraseña incorrectos.', 'error');
});

$('salir').addEventListener('click', () => supabase.auth.signOut());

supabase.auth.onAuthStateChange((_evento, session) => {
  vistaLogin.hidden = !!session;
  vistaApp.hidden = !session;
  if (session) setTimeout(cargar, 0);
  else filas.replaceChildren();
});
