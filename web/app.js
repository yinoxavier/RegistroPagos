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
  pagos: [],               // todos los pagos (para resumen y Excel)
  vista: 'pago',
};

/* ================= Utilidades ================= */

const dinero = (centavos) =>
  '$' + (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pendiente = (p) => Math.max(p.meta_centavos - p.pagado_centavos, 0);
const porcentaje = (p) => Math.min(100, Math.round((p.pagado_centavos / p.meta_centavos) * 100));

const fecha = (iso) => new Date(iso).toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' });

/** Fecha corta: "21 oct" (con año solo si no es el actual). */
function fechaCorta(iso) {
  const d = new Date(iso);
  const opciones = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opciones.year = 'numeric';
  return d.toLocaleDateString('es-PA', opciones).replace('.', '');
}

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
  const [personas, tipos, pagos] = await Promise.all([
    supabase.from('personas_resumen').select('*').order('nombre'),
    supabase.from('tipos').select('*').order('orden'),
    supabase.from('pagos').select('id, persona_id, monto_centavos, fecha, estado_correo').order('id', { ascending: false }),
  ]);
  if (personas.error || tipos.error || pagos.error) {
    $('vacio').hidden = false;
    $('vacio').textContent = 'No se pudo cargar el listado. Actualiza la página.';
    return;
  }
  estado.personas = personas.data;
  estado.tipos = tipos.data;
  estado.pagos = pagos.data;

  // Mantener actualizada la persona elegida
  if (estado.elegida) {
    estado.elegida = estado.personas.find((p) => p.id === estado.elegida.id) ?? null;
  }

  pintarTodo();
}

function pintarTodo() {
  pintarUltimaSync();
  pintarHojas();
  pintarTiposFormulario();
  pintarFiltroTipo();
  pintarElegida();
  pintarListado();
  pintarResumen();
}

/* ================= Pestañas ================= */

const VISTAS = ['pago', 'listado', 'resumen'];

function irA(vista, { enfocar = false } = {}) {
  if (!VISTAS.includes(vista)) vista = 'pago';
  estado.vista = vista;
  for (const v of VISTAS) $(`vista-${v}`).hidden = v !== vista;
  document.querySelectorAll('.pestanas a').forEach((a) => {
    if (a.dataset.vista === vista) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (location.hash !== `#${vista}`) history.replaceState(null, '', `#${vista}`);
  if (enfocar) $(`vista-${vista}`).querySelector('h1')?.focus?.();
}

window.addEventListener('hashchange', () => irA(location.hash.slice(1)));

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
      avisar(msg, `Pago registrado, pero el correo no se pudo enviar. Puedes reenviarlo desde el Listado.`, 'error');
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

function pintarUltimaSync() {
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
  t.replaceChildren(`${lista.length} persona${lista.length === 1 ? '' : 's'} · recaudado `,
    el('b', { text: dinero(pagado) }), ' de ', el('b', { text: dinero(meta) }),
    ` · ${completos} completo${completos === 1 ? '' : 's'}`);
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
    onclick: () => { irA('pago'); elegir(p); window.scrollTo({ top: 0 }); },
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

/* ================= Resumen ================= */

function estadoPersona(p) {
  if (pendiente(p) === 0) return 'Completo';
  return p.num_pagos ? 'Abonando' : 'Sin pagos';
}

function totalesDe(lista) {
  const meta = lista.reduce((s, p) => s + p.meta_centavos, 0);
  const pagado = lista.reduce((s, p) => s + p.pagado_centavos, 0);
  return {
    personas: lista.length,
    meta,
    pagado,
    pendiente: meta - pagado,
    completos: lista.filter((p) => pendiente(p) === 0).length,
    abonando: lista.filter((p) => pendiente(p) > 0 && p.num_pagos > 0).length,
    sinPagos: lista.filter((p) => p.num_pagos === 0).length,
  };
}

const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);

function barraSimple(parte, total, etiqueta) {
  const span = el('span');
  span.style.width = `${Math.min(100, pct(parte, total))}%`;
  return el('div', {
    class: `barra-avance${total && parte >= total ? ' completa' : ''}`,
    role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct(parte, total),
    'aria-label': etiqueta,
  }, span);
}

function kpi(titulo, valor, detalle) {
  return el('div', { class: 'kpi' },
    el('span', { class: 'kpi-titulo', text: titulo }),
    el('b', { class: 'kpi-valor', text: valor }),
    detalle ? el('span', { class: 'kpi-detalle', text: detalle }) : null);
}

function pintarResumen() {
  const t = totalesDe(estado.personas);
  const enviados = estado.pagos.filter((g) => g.estado_correo === 'enviado').length;
  const noEnviados = estado.pagos.length - enviados;

  $('kpis').replaceChildren(
    kpi('Recaudado', dinero(t.pagado), `${pct(t.pagado, t.meta)}% de ${dinero(t.meta)}`),
    kpi('Por cobrar', dinero(t.pendiente), `${t.abonando + t.sinPagos} persona${t.abonando + t.sinPagos === 1 ? '' : 's'} con saldo`),
    kpi('Personas', String(t.personas), `${t.completos} completo${t.completos === 1 ? '' : 's'} · ${t.sinPagos} sin pagos`),
    kpi('Pagos registrados', String(estado.pagos.length),
      noEnviados ? `${noEnviados} recibo${noEnviados === 1 ? '' : 's'} sin enviar` : 'Todos los recibos enviados'),
  );

  $('por-tipo').replaceChildren(...estado.tipos.map((tipo) => {
    const lista = estado.personas.filter((p) => p.tipo === tipo.id);
    const r = totalesDe(lista);
    return el('div', { class: 'tarjeta tipo-resumen' },
      el('div', { class: 'tipo-cabeza' },
        el('h2', {}, plural(tipo.nombre), ' ', el('span', { class: `insignia ${tipo.id}`, text: `Meta ${dinero(tipo.meta_centavos)}` })),
        el('span', { class: 'suave', text: `${r.personas} persona${r.personas === 1 ? '' : 's'}` })),
      barraSimple(r.pagado, r.meta, `Recaudado de ${plural(tipo.nombre)}`),
      el('div', { class: 'cifras' },
        el('span', {}, el('b', { text: dinero(r.pagado) }), ` de ${dinero(r.meta)}`),
        el('span', { class: 'suave', text: `Falta ${dinero(r.pendiente)}` })),
      el('dl', { class: 'desglose' },
        el('div', {}, el('dt', { text: 'Completos' }), el('dd', { text: r.completos })),
        el('div', {}, el('dt', { text: 'Abonando' }), el('dd', { text: r.abonando })),
        el('div', {}, el('dt', { text: 'Sin pagos' }), el('dd', { text: r.sinPagos }))));
  }));

  const porId = new Map(estado.personas.map((p) => [p.id, p]));
  const ultimos = estado.pagos.slice(0, 10);
  $('sin-pagos').hidden = ultimos.length > 0;
  $('ultimos-pagos').replaceChildren(...ultimos.map((g) => {
    const p = porId.get(g.persona_id);
    return el('tr', {},
      el('td', { class: 'fecha', text: fechaCorta(g.fecha), title: fecha(g.fecha) }),
      el('td', { text: p?.nombre ?? '—' }),
      el('td', {}, p ? insignia(p) : ''),
      el('td', { class: 'num', text: dinero(g.monto_centavos) }),
      el('td', {}, el('span', { class: `estado ${g.estado_correo}`, text: ETIQUETAS[g.estado_correo] ?? g.estado_correo })));
  }));
}

/* ================= Excel ================= */

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const FMT_DINERO = '"$"#,##0.00';
const FMT_FECHA = 'dd/mm/yyyy hh:mm';

/** Fecha local → número de serie de Excel (evita desfases de zona horaria). */
function serialExcel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return utc / 86400000 + 25569;
}

function hojaDesde(XLSX, encabezados, filas, formatos, anchos) {
  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
  // Formato por columna (dinero, porcentaje, fecha)
  formatos.forEach((fmt, c) => {
    if (!fmt) return;
    for (let r = 1; r <= filas.length; r++) {
      const celda = ws[XLSX.utils.encode_cell({ r, c })];
      if (celda && celda.v !== '' && celda.v != null) celda.z = fmt;
    }
  });
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  if (filas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } }) };
  return ws;
}

async function descargarExcel() {
  const boton = $('descargar-excel');
  const msg = $('mensaje-excel');
  boton.disabled = true;
  boton.textContent = 'Preparando…';
  avisar(msg, '');
  try {
    await cargar(); // datos al día
    const XLSX = await import(XLSX_URL);
    const libro = XLSX.utils.book_new();
    const usd = (c) => Math.round(c) / 100;

    // Resumen
    const filasResumen = estado.tipos.map((t) => {
      const r = totalesDe(estado.personas.filter((p) => p.tipo === t.id));
      return [plural(t.nombre), usd(t.meta_centavos), r.personas, usd(r.meta), usd(r.pagado), usd(r.pendiente),
        r.meta ? r.pagado / r.meta : 0, r.completos, r.abonando, r.sinPagos];
    });
    const tot = totalesDe(estado.personas);
    filasResumen.push(['Total', '', tot.personas, usd(tot.meta), usd(tot.pagado), usd(tot.pendiente),
      tot.meta ? tot.pagado / tot.meta : 0, tot.completos, tot.abonando, tot.sinPagos]);
    XLSX.utils.book_append_sheet(libro, hojaDesde(XLSX,
      ['Rol', 'Meta por persona', 'Personas', 'Meta total', 'Recaudado', 'Por cobrar', 'Avance', 'Completos', 'Abonando', 'Sin pagos'],
      filasResumen,
      [null, FMT_DINERO, null, FMT_DINERO, FMT_DINERO, FMT_DINERO, '0%', null, null, null],
      [16, 16, 10, 14, 14, 14, 9, 11, 10, 10]), 'Resumen');

    // Una hoja por rol
    for (const t of estado.tipos) {
      const filas = estado.personas.filter((p) => p.tipo === t.id).map((p) => [
        p.nombre, p.correo, p.cedula ?? '', p.whatsapp ?? '',
        usd(p.meta_centavos), usd(p.pagado_centavos), usd(pendiente(p)),
        p.meta_centavos ? p.pagado_centavos / p.meta_centavos : 0,
        estadoPersona(p), p.num_pagos, serialExcel(p.ultimo_pago),
      ]);
      XLSX.utils.book_append_sheet(libro, hojaDesde(XLSX,
        ['Nombre', 'Correo', 'Cédula', 'WhatsApp', 'Meta', 'Pagado', 'Pendiente', 'Avance', 'Estado', 'N.º de pagos', 'Último pago'],
        filas,
        [null, null, null, null, FMT_DINERO, FMT_DINERO, FMT_DINERO, '0%', null, null, FMT_FECHA],
        [32, 32, 14, 13, 10, 10, 11, 9, 11, 12, 17]), plural(t.nombre));
    }

    // Todos los pagos
    const porId = new Map(estado.personas.map((p) => [p.id, p]));
    const filasPagos = [...estado.pagos].reverse().map((g) => {
      const p = porId.get(g.persona_id);
      return [String(g.id).padStart(6, '0'), serialExcel(g.fecha), p?.nombre ?? '', p?.tipo_nombre ?? '', p?.correo ?? '',
        usd(g.monto_centavos), ETIQUETAS[g.estado_correo] ?? g.estado_correo];
    });
    XLSX.utils.book_append_sheet(libro, hojaDesde(XLSX,
      ['Recibo N.º', 'Fecha', 'Nombre', 'Rol', 'Correo', 'Monto', 'Recibo por correo'],
      filasPagos,
      [null, FMT_FECHA, null, null, null, FMT_DINERO, null],
      [11, 17, 32, 13, 32, 10, 17]), 'Pagos');

    const hoy = new Date();
    const nombre = `registro-pagos-${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(libro, nombre, { compression: true });
    avisar(msg, `Descargado: ${nombre}`, 'ok');
  } catch (err) {
    console.error(err);
    avisar(msg, 'No se pudo generar el Excel. Revisa tu conexión e intenta de nuevo.', 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Descargar Excel';
  }
}

$('descargar-excel').addEventListener('click', descargarExcel);

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
    irA(location.hash.slice(1) || 'pago');
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
