import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);

if (SUPABASE_URL.includes('TU-PROYECTO')) {
  document.body.innerHTML =
    '<p style="padding:24px">Falta configurar <code>web/config.js</code> con los datos de Supabase.</p>';
  throw new Error('Supabase sin configurar');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================= Estado ================= */

const estado = {
  personas: [],            // filas de personas_resumen
  tipos: [],               // filas de tipos
  elegida: null,           // persona elegida para el pago
  abiertas: new Set(),     // personas con historial desplegado
  filtroTipo: 'todos',
};

/* ================= Utilidades ================= */

const dinero = (centavos) =>
  '$' + (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pendiente = (p) => Math.max(p.meta_centavos - p.pagado_centavos, 0);
const porcentaje = (p) => Math.min(100, Math.round((p.pagado_centavos / p.meta_centavos) * 100));

const fecha = (iso) => new Date(iso).toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' });

function hace(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return fecha(iso);
}

function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') nodo.className = v;
    else if (k === 'text') nodo.textContent = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) nodo.setAttribute(k, v === true ? '' : v);
  }
  nodo.append(...hijos.filter((h) => h !== null && h !== undefined && h !== false));
  return nodo;
}

function avisar(nodo, texto, tipo = '') {
  nodo.className = `mensaje ${tipo}`;
  nodo.textContent = texto;
}

function barra(p) {
  const completa = pendiente(p) === 0;
  const span = el('span');
  span.style.width = `${porcentaje(p)}%`;
  return el('div', {
    class: `barra-avance${completa ? ' completa' : ''}`,
    role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': porcentaje(p),
    'aria-label': `Avance de ${p.nombre}`,
  }, span);
}

const plural = (nombre, n = 2) => (n === 1 ? nombre : nombre + (/[aeiou]$/i.test(nombre) ? 's' : 'es'));

const insignia = (p) => el('span', { class: `insignia ${p.tipo}`, text: p.tipo_nombre });

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

/* ================= Carga de datos ================= */

async function cargar() {
  const [personas, tipos] = await Promise.all([
    supabase.from('personas_resumen').select('*').order('nombre'),
    supabase.from('tipos').select('*').order('orden'),
  ]);
  if (personas.error || tipos.error) {
    $('vacio').hidden = false;
    $('vacio').textContent = 'No se pudo cargar el listado. Actualiza la página.';
    return;
  }
  estado.personas = personas.data;
  estado.tipos = tipos.data;

  // Mantener actualizada la persona elegida
  if (estado.elegida) {
    estado.elegida = estado.personas.find((p) => p.id === estado.elegida.id) ?? null;
  }

  pintarTodo();
}

function pintarTodo() {
  pintarConteos();
  pintarHojas();
  pintarTiposFormulario();
  pintarFiltroTipo();
  pintarElegida();
  pintarListado();
}

/* ================= Nuevo pago ================= */

const buscar = $('buscar-persona');
const resultados = $('resultados-persona');
let activo = -1;

function coincide(p, consulta) {
  const q = normalizar(consulta).trim();
  if (!q) return true;
  const texto = normalizar(`${p.nombre} ${p.correo} ${p.cedula ?? ''}`);
  return q.split(/\s+/).every((parte) => texto.includes(parte));
}

function mostrarResultados() {
  const q = buscar.value;
  const lista = estado.personas.filter((p) => coincide(p, q)).slice(0, 8);
  resultados.replaceChildren();
  activo = -1;

  if (!lista.length) {
    resultados.append(el('li', { class: 'nada', text: 'No hay personas con ese nombre.' }));
  }
  lista.forEach((p, i) => {
    const falta = pendiente(p);
    resultados.append(el('li', {
      role: 'option', id: `op-${p.id}`, 'aria-selected': 'false',
      onmousedown: (e) => { e.preventDefault(); elegir(p); },
      'data-i': i,
    },
    el('span', {}, p.nombre, insignia(p)),
    el('small', { text: falta === 0 ? 'Completo' : `Faltan ${dinero(falta)}` })));
  });
  resultados._lista = lista;
  resultados.hidden = false;
  buscar.setAttribute('aria-expanded', 'true');
}

function ocultarResultados() {
  resultados.hidden = true;
  buscar.setAttribute('aria-expanded', 'false');
}

function marcarActivo(i) {
  const items = [...resultados.querySelectorAll('li[role="option"]')];
  if (!items.length) return;
  activo = (i + items.length) % items.length;
  items.forEach((li, j) => li.setAttribute('aria-selected', String(j === activo)));
  items[activo].scrollIntoView({ block: 'nearest' });
  buscar.setAttribute('aria-activedescendant', items[activo].id);
}

buscar.addEventListener('input', mostrarResultados);
buscar.addEventListener('focus', mostrarResultados);
buscar.addEventListener('blur', () => setTimeout(ocultarResultados, 100));
buscar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (resultados.hidden) mostrarResultados(); marcarActivo(activo + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); marcarActivo(activo - 1); }
  else if (e.key === 'Enter' && !resultados.hidden && activo >= 0) { e.preventDefault(); elegir(resultados._lista[activo]); }
  else if (e.key === 'Escape') ocultarResultados();
});

function elegir(p) {
  estado.elegida = p;
  buscar.value = '';
  ocultarResultados();
  avisar($('mensaje-pago'), '');
  pintarElegida();
  $('monto').focus();
}

$('quitar-persona').addEventListener('click', () => {
  estado.elegida = null;
  pintarElegida();
  buscar.focus();
});

function pintarElegida() {
  const p = estado.elegida;
  $('persona-elegida').hidden = !p;
  buscar.closest('.buscador').hidden = !!p;
  const saldoBtn = $('pagar-saldo');
  if (!p) { saldoBtn.hidden = true; return; }

  $('elegida-nombre').textContent = p.nombre;
  const ins = $('elegida-tipo');
  ins.className = `insignia ${p.tipo}`;
  ins.textContent = p.tipo_nombre;
  $('elegida-correo').textContent = p.correo;
  const b = $('elegida-barra');
  b.style.width = `${porcentaje(p)}%`;
  b.parentElement.classList.toggle('completa', pendiente(p) === 0);

  const falta = pendiente(p);
  $('elegida-texto').textContent = falta === 0
    ? `Completó su aporte de ${dinero(p.meta_centavos)}.`
    : `Ha pagado ${dinero(p.pagado_centavos)} de ${dinero(p.meta_centavos)} · faltan ${dinero(falta)}`;

  saldoBtn.hidden = falta === 0;
  saldoBtn.textContent = `Saldo ${dinero(falta)}`;
  $('monto').disabled = falta === 0;
}

$('monto').addEventListener('input', () => avisar($('mensaje-pago'), ''));

$('pagar-saldo').addEventListener('click', () => {
  if (!estado.elegida) return;
  avisar($('mensaje-pago'), '');
  $('monto').value = (pendiente(estado.elegida) / 100).toFixed(2);
  $('monto').focus();
});

$('form-pago').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('mensaje-pago');
  const p = estado.elegida;
  if (!p) return avisar(msg, 'Primero busca y elige a la persona.', 'error');

  const montoTexto = $('monto').value.trim().replace(',', '.');
  const centavos = Math.round(Number(montoTexto) * 100);
  if (!/^\d+(\.\d{1,2})?$/.test(montoTexto) || centavos <= 0) {
    return avisar(msg, 'Escribe un monto válido, por ejemplo 20 o 15.50.', 'error');
  }
  if (centavos > pendiente(p)) {
    return avisar(msg, `El monto supera lo pendiente (${dinero(pendiente(p))}).`, 'error');
  }

  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  avisar(msg, 'Registrando y enviando recibo…');
  try {
    const pago = await llamarFuncion({ accion: 'registrar', persona_id: p.id, monto: montoTexto });
    $('monto').value = '';
    if (pago.estado_correo === 'enviado') {
      avisar(msg, `Pago de ${dinero(pago.monto_centavos)} registrado. Recibo enviado a ${pago.correo}.`, 'ok');
    } else {
      avisar(msg, `Pago registrado, pero el correo no se pudo enviar. Puedes reenviarlo desde el listado.`, 'error');
    }
    estado.abiertas.add(p.id);
    await cargar();
  } catch (err) {
    avisar(msg, err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

/* ================= Personas registradas ================= */

function pintarConteos() {
  const caja = $('conteos');
  caja.replaceChildren(...estado.tipos.map((t) => {
    const n = estado.personas.filter((p) => p.tipo === t.id).length;
    return el('div', { class: 'conteo' },
      el('b', { text: n }),
      el('span', { text: plural(t.nombre, n) }),
      el('span', { text: `Meta ${dinero(t.meta_centavos)}` }));
  }));

  const ultimas = estado.tipos.map((t) => t.sincronizado_en).filter(Boolean).sort();
  $('ultima-sync').textContent = `Última sincronización: ${hace(ultimas.at(-1))}`;
}

function pintarTiposFormulario() {
  const sel = $('tipo-persona');
  if (sel.options.length === estado.tipos.length) return;
  sel.replaceChildren(...estado.tipos.map((t) =>
    el('option', { value: t.id, text: `${t.nombre} (${dinero(t.meta_centavos)})` })));
}

function pintarHojas() {
  $('hojas').replaceChildren(...estado.tipos.map((t) => {
    const url = t.hoja_id
      ? `https://docs.google.com/spreadsheets/d/${t.hoja_id}/edit#gid=${t.hoja_gid ?? 0}` : '';
    const input = el('input', { type: 'url', placeholder: 'Pega el enlace de Google Sheets', value: url });
    const msg = el('p', { class: 'mensaje' });
    const guardar = el('button', {
      type: 'button', class: 'secundario', text: 'Guardar',
      onclick: async () => {
        guardar.disabled = true;
        avisar(msg, 'Comprobando la hoja…');
        try {
          await llamarFuncion({ accion: 'configurar_hoja', tipo: t.id, enlace: input.value });
          avisar(msg, 'Hoja guardada.', 'ok');
          await cargar();
        } catch (err) { avisar(msg, err.message, 'error'); }
        finally { guardar.disabled = false; }
      },
    });
    return el('div', { class: 'hoja' },
      el('span', {}, el('strong', { text: t.nombre }), ' ',
        url ? el('a', { href: url, target: '_blank', rel: 'noopener', text: 'Abrir hoja' }) : el('span', { class: 'suave', text: 'sin hoja' })),
      el('div', { class: 'hoja-fila' }, input, guardar),
      msg);
  }));
}

async function sincronizar({ silencioso = false } = {}) {
  const boton = $('sincronizar');
  const caja = $('resultado-sync');
  boton.disabled = true;
  boton.textContent = 'Sincronizando…';
  if (!silencioso) caja.replaceChildren();

  try {
    const { resultados } = await llamarFuncion({ accion: 'sincronizar' });
    caja.replaceChildren(...resultados.map((r) => {
      if (r.error) return el('div', { class: 'linea error', text: `${r.tipo_nombre}: ${r.error}` });

      const partes = [`${r.filas} inscrito${r.filas === 1 ? '' : 's'} en la hoja`];
      if (r.creadas) partes.push(`${r.creadas} nuevo${r.creadas === 1 ? '' : 's'}`);
      if (r.actualizadas) partes.push(`${r.actualizadas} actualizado${r.actualizadas === 1 ? '' : 's'}`);
      const linea = el('div', { class: `linea${r.omitidas.length ? ' aviso' : ''}` },
        el('strong', { text: `${r.tipo_nombre}: ` }), partes.join(' · '));

      if (r.omitidas.length) {
        linea.append(el('div', { text: `${r.omitidas.length} no se cargaron:` }),
          el('ul', {}, ...r.omitidas.slice(0, 15).map((o) =>
            el('li', { text: `${o.fila ? `Fila ${o.fila}` : ''}${o.fila && o.nombre ? ' · ' : ''}${o.nombre}: ${o.motivo}` }))),
          ...(r.omitidas.length > 15 ? [el('div', { text: `…y ${r.omitidas.length - 15} más.` })] : []));
      }
      return linea;
    }));
    await cargar();
  } catch (err) {
    caja.replaceChildren(el('div', { class: 'linea error', text: err.message }));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Sincronizar inscripciones';
  }
}

$('sincronizar').addEventListener('click', () => sincronizar());

$('form-persona').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('mensaje-persona');
  const boton = e.target.querySelector('button');
  boton.disabled = true;
  try {
    const datos = Object.fromEntries(new FormData(e.target));
    const persona = await llamarFuncion({ accion: 'crear_persona', ...datos });
    e.target.reset();
    avisar(msg, `${persona.nombre} agregado.`, 'ok');
    await cargar();
  } catch (err) {
    avisar(msg, err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

/* ================= Listado ================= */

function pintarFiltroTipo() {
  const caja = $('filtro-tipo');
  const opciones = [{ id: 'todos', nombre: 'Todos' }, ...estado.tipos.map((t) => ({ id: t.id, nombre: plural(t.nombre) }))];
  caja.replaceChildren(...opciones.map((o) => el('button', {
    type: 'button', text: o.nombre, 'aria-pressed': String(estado.filtroTipo === o.id),
    onclick: () => { estado.filtroTipo = o.id; pintarFiltroTipo(); pintarListado(); },
  })));
}

$('filtro-texto').addEventListener('input', () => pintarListado());
$('filtro-estado').addEventListener('change', () => pintarListado());

function pintarTotales(lista) {
  const meta = lista.reduce((s, p) => s + p.meta_centavos, 0);
  const pagado = lista.reduce((s, p) => s + p.pagado_centavos, 0);
  const completos = lista.filter((p) => pendiente(p) === 0).length;
  const t = $('totales');
  t.replaceChildren('Recaudado ', el('b', { text: dinero(pagado) }), ' de ', el('b', { text: dinero(meta) }),
    ` · ${completos} de ${lista.length} completos`);
}

function pintarListado() {
  const q = $('filtro-texto').value;
  const est = $('filtro-estado').value;
  const porTipo = estado.personas.filter((p) => estado.filtroTipo === 'todos' || p.tipo === estado.filtroTipo);
  pintarTotales(porTipo);

  const lista = porTipo.filter((p) => {
    if (!coincide(p, q)) return false;
    if (est === 'pendientes') return pendiente(p) > 0;
    if (est === 'completos') return pendiente(p) === 0;
    if (est === 'sin-pagos') return p.num_pagos === 0;
    return true;
  });

  const ul = $('personas');
  ul.replaceChildren(...lista.map(filaPersona));

  const vacio = $('vacio');
  vacio.hidden = lista.length > 0;
  vacio.textContent = estado.personas.length === 0
    ? 'Aún no hay personas. Pulsa «Sincronizar inscripciones» para traerlas de las hojas.'
    : 'Nadie coincide con el filtro.';
}

function filaPersona(p) {
  const falta = pendiente(p);
  const li = el('li', { class: 'persona' });
  const historial = el('div', { class: 'historial', hidden: !estado.abiertas.has(p.id) });

  const verPagos = el('button', {
    type: 'button', class: 'enlace',
    text: p.num_pagos ? `${p.num_pagos} pago${p.num_pagos === 1 ? '' : 's'}` : 'Sin pagos',
    'aria-expanded': String(estado.abiertas.has(p.id)),
    disabled: p.num_pagos === 0,
    onclick: () => {
      const abrir = historial.hidden;
      historial.hidden = !abrir;
      verPagos.setAttribute('aria-expanded', String(abrir));
      if (abrir) { estado.abiertas.add(p.id); cargarHistorial(p, historial); }
      else estado.abiertas.delete(p.id);
    },
  });

  const pagar = falta > 0 ? el('button', {
    type: 'button', class: 'enlace', text: 'Pagar',
    onclick: () => { elegir(p); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  }) : null;

  li.append(
    el('div', { class: 'persona-fila' },
      el('div', { class: 'persona-nombre' },
        el('strong', { text: p.nombre }), insignia(p),
        el('small', { text: p.correo })),
      el('div', { class: 'persona-avance' },
        barra(p),
        el('div', { class: 'cifras' },
          el('span', { text: `${dinero(p.pagado_centavos)} / ${dinero(p.meta_centavos)}` }),
          el('span', { class: `falta${falta === 0 ? ' listo' : ''}`, text: falta === 0 ? 'Completo' : `Faltan ${dinero(falta)}` }))),
      el('div', { class: 'persona-acciones' }, pagar, verPagos)),
    historial);

  if (estado.abiertas.has(p.id) && p.num_pagos) cargarHistorial(p, historial);
  return li;
}

const ETIQUETAS = { enviado: 'Enviado', error: 'No enviado', pendiente: 'Pendiente' };

async function cargarHistorial(p, caja) {
  caja.replaceChildren(el('p', { text: 'Cargando pagos…' }));
  const { data, error } = await supabase.from('pagos')
    .select('id, monto_centavos, fecha, estado_correo, error_correo')
    .eq('persona_id', p.id).order('id');
  if (error) return caja.replaceChildren(el('p', { text: 'No se pudieron cargar los pagos.' }));
  if (!data.length) return caja.replaceChildren(el('p', { text: 'Sin pagos todavía.' }));

  const filas = data.map((g) => {
    const estadoCorreo = el('span', { class: `estado ${g.estado_correo}`, text: ETIQUETAS[g.estado_correo] ?? g.estado_correo });
    if (g.error_correo) estadoCorreo.title = g.error_correo;

    const reenviar = g.estado_correo !== 'enviado' ? el('button', {
      type: 'button', class: 'enlace', text: 'Reenviar',
      onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Enviando…';
        try { await llamarFuncion({ accion: 'reenviar', id: g.id }); }
        catch (err) { alert(err.message); }
        cargarHistorial(p, caja);
      },
    }) : null;

    return el('tr', {},
      el('td', { class: 'fecha', text: fecha(g.fecha) }),
      el('td', { class: 'num', text: dinero(g.monto_centavos) }),
      el('td', { class: 'acciones' },
        el('a', { href: '#', text: 'PDF', onclick: (e) => { e.preventDefault(); abrirRecibo(g.id); } }),
        estadoCorreo, reenviar));
  });
  caja.replaceChildren(el('table', {}, el('tbody', {}, ...filas)));
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

/* ================= Sesión ================= */

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

let iniciado = false;
supabase.auth.onAuthStateChange((_evento, session) => {
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (session && !iniciado) {
    iniciado = true;
    setTimeout(async () => {
      await cargar();
      // Sincroniza solo si pasaron más de 15 minutos desde la última vez
      const ultima = estado.tipos.map((t) => t.sincronizado_en).filter(Boolean).sort().at(-1);
      if (!ultima || Date.now() - new Date(ultima).getTime() > 15 * 60000) sincronizar({ silencioso: true });
    }, 0);
  } else if (!session) {
    iniciado = false;
    estado.personas = [];
    estado.elegida = null;
    $('personas').replaceChildren();
  }
});
