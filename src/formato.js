const config = require('./config');

function numeroRecibo(id) {
  return String(id).padStart(6, '0');
}

function formatearMonto(centavos) {
  const valor = (centavos / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${valor} ${config.moneda}`;
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleString('es-PA', {
    timeZone: config.zonaHoraria,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = { numeroRecibo, formatearMonto, formatearFecha };
