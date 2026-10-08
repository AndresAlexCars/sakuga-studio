import crypto from 'node:crypto';
import { config } from '../config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (value) => crypto.createHash('sha256').update(value).digest();

// Cada navegador/teléfono genera un id propio; el historial se separa por ese id.
export function requireClient(req, res, next) {
  const id = req.get('x-client-id') || '';
  if (!UUID.test(id)) {
    return res.status(400).json({ error: 'Falta el identificador del dispositivo. Recarga la página.' });
  }
  req.clientId = id.toLowerCase();
  next();
}

// Si ACCESS_CODE está definido, todas las rutas protegidas lo exigen.
export function requireAccess(req, res, next) {
  if (!config.accessCode) return next();
  const given = req.get('x-access-code') || '';
  if (!crypto.timingSafeEqual(digest(given), digest(config.accessCode))) {
    return res.status(401).json({ error: 'Código de acceso incorrecto.' });
  }
  next();
}
