/**
 * coordinates.js
 * ---------------------------------------------------------------------------
 * Conversione tra riferimenti "spreadsheet" (A1, B12, CV100) e indici interni.
 *
 * Convenzione interna:
 *   - riga  `r` : intero 0-based  (0 = riga 1)
 *   - colonna `c`: intero 0-based  (0 = colonna A, 25 = Z, 26 = AA, 99 = CV)
 *
 * Le chiavi delle celle sono numeriche (`r * 1000 + c`) per performance: sono
 * usate come chiavi di Map/Set dentro il motore di calcolo, che ne gestisce
 * decine di migliaia al secondo durante il ricalcolo incrementale.
 */

/** Righe della griglia (requisito minimo: 100). */
export const MAX_ROWS = 100;
/** Colonne della griglia (requisito minimo: 100 -> da A a CV). */
export const MAX_COLS = 100;
/** Limiti assoluti utilizzabili quando si inseriscono righe/colonne. */
export const HARD_MAX_ROWS = 500;
export const HARD_MAX_COLS = 200;
/** Limiti minimi (la griglia non può scendere sotto queste dimensioni). */
export const MIN_ROWS = 10;
export const MIN_COLS = 5;

/** Conversione indice colonna (0-based) -> etichetta Excel ("A", "AA", "CV"). */
export function colToLetters(col) {
  let n = col;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Conversione etichetta Excel ("A", "AA") -> indice colonna 0-based. */
export function lettersToCol(letters) {
  let n = 0;
  const up = letters.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    n = n * 26 + (up.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Chiave numerica interna di una cella. */
export function cellKey(r, c) {
  return r * 1000 + c;
}

/** Decodifica una chiave numerica in {r, c}. */
export function fromKey(key) {
  return { r: Math.floor(key / 1000), c: key % 1000 };
}

/** Nome leggibile della cella: (0,0) -> "A1". */
export function cellName(r, c) {
  return colToLetters(c) + (r + 1);
}

/**
 * Parsing di un riferimento singolo ("A1", "$B$7", "cv100").
 * @returns {{r:number,c:number,absRow:boolean,absCol:boolean}|null}
 */
export function parseCellRef(text) {
  const raw = String(text).trim();
  const m = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/.exec(raw);
  if (!m) return null;
  const c = lettersToCol(m[1]);
  const r = parseInt(m[2], 10) - 1;
  if (r < 0) return null;
  // I segni "$" vengono preservati per la ricostruzione testuale delle formule.
  const colPart = raw.slice(0, raw.length - m[2].length);
  const absCol = colPart.startsWith('$');
  const absRow = /\$$/.test(colPart);
  return { r, c, absRow, absCol };
}

/** True se la stringa è un riferimento a cella valido. */
export function isCellRef(text) {
  return parseCellRef(text) !== null;
}

/**
 * Parsing di un intervallo rettangolare "A1:B5".
 * @returns {{r1:number,c1:number,r2:number,c2:number}|null}
 */
export function parseRangeText(text) {
  const parts = String(text).split(':');
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (!a || !b) return null;
  return normalizeRect(a, b);
}

/** Normalizza due angoli in un rettangolo (r1<=r2, c1<=c2). */
export function normalizeRect(a, b) {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

/** Nome leggibile di un rettangolo: "A1:B5". */
export function rectName(rect) {
  const a = cellName(rect.r1, rect.c1);
  const b = cellName(rect.r2, rect.c2);
  return a === b ? a : `${a}:${b}`;
}

/** Il rettangolo contiene la cella (r, c)? */
export function rectContains(rect, r, c) {
  return r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
}

/** Numero di celle contenute in un rettangolo. */
export function rectArea(rect) {
  return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
}

/** Intersezione tra due rettangoli (null se disgiunti). */
export function rectIntersect(a, b) {
  const r1 = Math.max(a.r1, b.r1);
  const c1 = Math.max(a.c1, b.c1);
  const r2 = Math.min(a.r2, b.r2);
  const c2 = Math.min(a.c2, b.c2);
  if (r1 > r2 || c1 > c2) return null;
  return { r1, c1, r2, c2 };
}

/**
 * Costruisce un rettangolo a partire da due riferimenti cella.
 * @returns {{r1:number,c1:number,r2:number,c2:number}}
 */
export function rectFromCells(a, b) {
  return normalizeRect(a, b);
}
