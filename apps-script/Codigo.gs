/**
 * Registro de pagos · Comunidad Católica Shalom
 * Recibe los datos de la plataforma y reescribe las pestañas de esta hoja.
 *
 * Instalación: Extensiones → Apps Script → pegar este código → Implementar →
 * Nueva implementación → Aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario).
 */

// Clave compartida con la plataforma (la misma que está guardada en Supabase).
const TOKEN = 'PEGA_AQUI_LA_CLAVE';

const FORMATOS = {
  dinero: '"$"#,##0.00',
  porcentaje: '0%',
  fecha: 'dd/mm/yyyy HH:mm',
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const datos = JSON.parse(e.postData.contents);
    if (datos.token !== TOKEN) return responder({ ok: false, error: 'Clave inválida' });

    const libro = SpreadsheetApp.getActiveSpreadsheet();
    const props = PropertiesService.getScriptProperties();

    // Ignorar datos más viejos que los ya escritos (dos pagos casi al mismo tiempo)
    const ultimo = props.getProperty('generado');
    if (ultimo && datos.generado < ultimo) {
      return responder({ ok: true, omitido: true, url: libro.getUrl() });
    }

    datos.hojas.forEach((h, i) => escribirHoja(libro, h, i));
    borrarHojaVaciaInicial(libro, datos.hojas.map((h) => h.nombre));
    props.setProperty('generado', datos.generado);

    return responder({ ok: true, url: libro.getUrl() });
  } catch (err) {
    return responder({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return responder({ ok: true, mensaje: 'Registro de pagos: listo', url: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
}

function escribirHoja(libro, h, posicion) {
  let hoja = libro.getSheetByName(h.nombre);
  if (!hoja) hoja = libro.insertSheet(h.nombre, posicion);

  const columnas = h.encabezados.length;
  const filas = h.filas.map((fila) => fila.map((v, c) =>
    h.formatos[c] === 'fecha' && v ? new Date(v) : (v === null || v === undefined ? '' : v)));

  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  hoja.getRange(1, 1, filas.length + 1, columnas).setValues([h.encabezados, ...filas]);

  hoja.getRange(1, 1, 1, columnas).setFontWeight('bold').setBackground('#e8eef6');
  hoja.setFrozenRows(1);

  if (filas.length) {
    h.formatos.forEach((f, c) => {
      if (FORMATOS[f]) hoja.getRange(2, c + 1, filas.length, 1).setNumberFormat(FORMATOS[f]);
    });
    hoja.getRange(1, 1, filas.length + 1, columnas).createFilter();
  }
  hoja.autoResizeColumns(1, columnas);
}

// Quita la "Hoja 1" vacía que trae una hoja nueva
function borrarHojaVaciaInicial(libro, nombres) {
  libro.getSheets().forEach((hoja) => {
    if (!nombres.includes(hoja.getName()) && hoja.getLastRow() === 0 && libro.getSheets().length > 1) {
      libro.deleteSheet(hoja);
    }
  });
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
