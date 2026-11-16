/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Persistenza locale (localStorage) e import/export CSV.
 *
 * I dati non lasciano mai il dispositivo: la PWA funziona interamente offline
 * e nessun contenuto del foglio viene inviato a server esterni.
 */

const STORAGE_KEY = 'mini-sheet-pwa/v1';
const PREFS_KEY = 'mini-sheet-pwa/prefs';

/** Salva il foglio su localStorage (con throttle lato chiamante). */
export function saveSheet(engine) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(engine.toJSON()));
    return true;
  } catch (e) {
    console.warn('[storage] impossibile salvare il foglio', e);
    return false;
  }
}

/** Carica il foglio da localStorage (null se assente o non valido). */
export function loadSheet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[storage] impossibile leggere il foglio', e);
    return null;
  }
}

/** Rimuove il foglio salvato. */
export function clearSavedSheet() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignorato */
  }
}

/** Salva le preferenze (tema, auto-ricalcolo, ...). */
export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignorato */
  }
}

/** Carica le preferenze. */
export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Esporta il foglio in CSV (valori visualizzati).
 * @param {import('./engine.js').SheetEngine} engine
 * @returns {string}
 */
export function sheetToCsv(engine) {
  const { rows, cols } = engine.getUsedRange();
  if (!rows) return '';
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      cells.push(csvEscape(engine.getDisplay(r, c)));
    }
    lines.push(cells.join(';'));
  }
  return lines.join('\r\n');
}

/** Escape di un campo CSV. */
function csvEscape(value) {
  const text = String(value ?? '');
  if (/[";\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

/**
 * Parser CSV minimalista (supporta i campi tra virgolette e i separatori
 * ';' o ',' con rilevamento automatico).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sep = detectSeparator(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rileva il separatore CSV piu' probabile. */
function detectSeparator(src) {
  const line = src.split('\n').find((l) => l.trim() !== '') ?? '';
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

/** Scarica un testo come file dal browser. */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
