const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS pagos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre         TEXT    NOT NULL,
    correo         TEXT    NOT NULL,
    monto_centavos INTEGER NOT NULL CHECK (monto_centavos > 0),
    fecha          TEXT    NOT NULL,
    estado_correo  TEXT    NOT NULL DEFAULT 'pendiente',
    error_correo   TEXT
  )
`);

const stmts = {
  insertar: db.prepare(
    'INSERT INTO pagos (nombre, correo, monto_centavos, fecha) VALUES (?, ?, ?, ?)'
  ),
  listar: db.prepare('SELECT * FROM pagos ORDER BY id DESC'),
  obtener: db.prepare('SELECT * FROM pagos WHERE id = ?'),
  estado: db.prepare('UPDATE pagos SET estado_correo = ?, error_correo = ? WHERE id = ?'),
};

function crearPago({ nombre, correo, montoCentavos }) {
  const fecha = new Date().toISOString();
  const { lastInsertRowid } = stmts.insertar.run(nombre, correo, montoCentavos, fecha);
  return obtenerPago(Number(lastInsertRowid));
}

function listarPagos() {
  return stmts.listar.all();
}

function obtenerPago(id) {
  return stmts.obtener.get(id) || null;
}

function actualizarEstadoCorreo(id, estado, error = null) {
  stmts.estado.run(estado, error, id);
}

module.exports = { crearPago, listarPagos, obtenerPago, actualizarEstadoCorreo };
