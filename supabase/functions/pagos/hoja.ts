// Lectura de las hojas de inscripción (Google Sheets compartidas con enlace).

export interface FilaInscripcion {
  fila: number;
  nombre: string;
  correo: string;
  cedula: string;
  whatsapp: string;
}

/** Extrae el id (y gid) de un enlace de Google Sheets, o acepta el id solo. */
export function idDesdeEnlace(enlace: string): { id: string; gid: string } | null {
  const texto = enlace.trim();
  const m = texto.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  const id = m?.[1] ?? (/^[a-zA-Z0-9_-]{20,}$/.test(texto) ? texto : null);
  if (!id) return null;
  const gid = texto.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
  return { id, gid };
}

/** Parser CSV (RFC 4180): comillas, comas y saltos de línea dentro de celdas. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  const s = texto.replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"' && s[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¿?:*]/g, '').trim();

export interface Columnas {
  nombre: number;
  apellido: number;
  correo: number;
  cedula: number;
  whatsapp: number;
}

/** Reconoce las columnas por su título (con o sin tildes). */
export function detectarColumnas(encabezados: string[]): Columnas {
  const h = encabezados.map(normalizar);
  const buscar = (prueba: (t: string) => boolean) => h.findIndex(prueba);

  let nombre = buscar((t) => t === 'nombre completo' || t === 'nombre y apellido' || t === 'nombres y apellidos');
  if (nombre < 0) nombre = buscar((t) => /^nombres?\b/.test(t) && !t.includes('grupo') && !t.includes('equipo'));
  const apellido = buscar((t) => /^apellidos?\b/.test(t));
  const correo = buscar((t) =>
    t.includes('correo') || t.includes('email') || t.includes('e-mail') || t === 'mail');
  const cedula = buscar((t) => t.startsWith('cedula') && !t.includes('repetid'));
  let whatsapp = buscar((t) => t.includes('whatsapp'));
  if (whatsapp < 0) {
    whatsapp = buscar((t) => (t.includes('celular') || t.includes('telefono')) &&
      !t.includes('emergencia') && !t.includes('responsable'));
  }

  return { nombre, apellido, correo, cedula, whatsapp };
}

/** Convierte el CSV en filas de inscripción (omite filas totalmente vacías). */
export function leerInscripciones(csv: string): { columnas: Columnas; filas: FilaInscripcion[] } {
  // Ignorar filas totalmente vacías al inicio (hoja nueva sin respuestas)
  const tabla = parsearCsv(csv);
  while (tabla.length && tabla[0].every((c) => c.trim() === '')) tabla.shift();
  const sinColumnas: Columnas = { nombre: -1, apellido: -1, correo: -1, cedula: -1, whatsapp: -1 };
  if (tabla.length === 0) return { columnas: sinColumnas, filas: [] }; // hoja vacía: nada que cargar

  const columnas = detectarColumnas(tabla[0]);
  const hayDatos = tabla.slice(1).some((f) => f.some((c) => c.trim() !== ''));
  if (columnas.nombre < 0) {
    if (!hayDatos) return { columnas, filas: [] };
    throw new Error('No encontré la columna "Nombre completo" en la hoja.');
  }

  const celda = (f: string[], i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');
  const filas: FilaInscripcion[] = [];
  tabla.slice(1).forEach((f, i) => {
    if (f.every((c) => c.trim() === '')) return;
    const nombre = [celda(f, columnas.nombre), celda(f, columnas.apellido)].filter(Boolean).join(' ');
    filas.push({
      fila: i + 2,
      nombre,
      correo: celda(f, columnas.correo),
      cedula: celda(f, columnas.cedula),
      whatsapp: celda(f, columnas.whatsapp),
    });
  });
  return { columnas, filas };
}

/** Descarga la hoja como CSV. Debe estar compartida como "cualquier persona con el enlace". */
export async function descargarHoja(id: string, gid = '0'): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const tipo = res.headers.get('content-type') ?? '';
  if (!res.ok || !tipo.includes('text/csv')) {
    throw new Error('No pude leer la hoja: verifica que esté compartida como "Cualquier persona con el enlace".');
  }
  return await res.text();
}
