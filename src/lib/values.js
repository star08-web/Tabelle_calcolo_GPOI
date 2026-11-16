/**
 * values.js
 * ---------------------------------------------------------------------------
 * Tipi di valore del motore di calcolo, conversioni e formattazione.
 *
 * Un "valore" puo' essere:
 *   number   -> numerico
 *   string   -> testo
 *   boolean  -> booleano (VERO / FALSO)
 *   SpreadsheetError -> errore (#DIV/0!, #VALORE!, #RIF!, #NOME? ...)
 *   null/undefined -> cella vuota
 */

export const ERR = {
  DIV0: '#DIV/0!',
  VALUE: '#VALORE!',
  REF: '#RIF!',
  NAME: '#NOME?',
  NUM: '#NUM!',
  NA: '#N/D',
};

/** Errore di foglio di calcolo. */
export class SpreadsheetError {
  /**
   * @param {string} code codice errore (es. "#DIV/0!")
   * @param {string} detail dettaglio leggibile (opzionale)
   * @param {boolean} circular true se e' un riferimento circolare
   */
  constructor(code, detail = '', circular = false) {
    this.code = code;
    this.detail = detail;
    this.circular = circular;
  }

  toString() {
    return this.code;
  }
}

/** Crea un errore di riferimento circolare. */
export function circularError(detail = 'Riferimento circolare') {
  return new SpreadsheetError(ERR.REF, detail, true);
}

export function isError(value) {
  return value instanceof SpreadsheetError;
}

/**
 * Valore "intervallo": viene prodotto dall'evaluator quando un nodo RANGE
 * viene usato come argomento di una funzione aggregata (SOMMA, MEDIA, ...).
 * Il resolve(r, c) restituisce il valore corrente della cella.
 */
export class RangeValue {
  /**
   * @param {{r1:number,c1:number,r2:number,c2:number}} rect rettangolo
   * @param {(r:number,c:number)=>*} resolve lettore delle celle
   * @param {{rows:number,cols:number}} bounds dimensioni correnti del foglio
   */
  constructor(rect, resolve, bounds) {
    this.kind = 'range';
    this.rect = rect;
    this.resolve = resolve;
    this.bounds = bounds;
  }

  /** Restituisce l'ultima riga/colonna effettiva (gli intervalli di colonna sono infiniti). */
  get clamped() {
    return {
      r1: this.rect.r1,
      c1: this.rect.c1,
      r2: Math.min(this.rect.r2, this.bounds.rows - 1),
      c2: Math.min(this.rect.c2, this.bounds.cols - 1),
    };
  }

  /** Itera su tutte le celle dell'intervallo, restituendo {r, c, value}. */
  *values() {
    const { r1, c1, r2, c2 } = this.clamped;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        yield { r, c, value: this.resolve(r, c) };
      }
    }
  }

  /** Numero di celle effettive dell'intervallo. */
  get size() {
    const { r1, c1, r2, c2 } = this.clamped;
    return Math.max(0, (r2 - r1 + 1) * (c2 - c1 + 1));
  }
}

/** Il valore e' un numero finito? */
export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Testo "vuoto" (cella non valorizzata). */
export function isBlank(value) {
  return value === null || value === undefined || value === '';
}

/**
 * Coercizione a numero (regole stile Excel).
 * Le celle vuote valgono 0; il testo numerico viene convertito; il testo non
 * numerico produce #VALORE!.
 * @returns {number|SpreadsheetError}
 */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : new SpreadsheetError(ERR.NUM, 'Numero non valido');
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (isBlank(value)) return 0;
  if (isError(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    const normalized = trimmed.replace(',', '.');
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalized)) {
      return parseFloat(normalized);
    }
    if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) {
      return parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
    }
    return new SpreadsheetError(ERR.VALUE, `Il valore "${value}" non e' un numero`);
  }
  return new SpreadsheetError(ERR.VALUE, 'Valore non convertibile in numero');
}

/** Coercizione a testo (regole stile Excel). */
export function toText(value) {
  if (value === null || value === undefined) return '';
  if (isError(value)) return value.code;
  if (typeof value === 'boolean') return value ? 'VERO' : 'FALSO';
  if (typeof value === 'number') return formatGeneral(value);
  return String(value);
}

/** Coercizione a booleano: 0/"" vuoto -> FALSO, tutto il resto -> VERO. */
export function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (isError(value)) return value;
  if (isBlank(value)) return false;
  if (typeof value === 'number') return value !== 0;
  const up = String(value).trim().toUpperCase();
  if (up === 'FALSO' || up === 'FALSE') return false;
  if (up === 'VERO' || up === 'TRUE') return true;
  const n = toNumber(value);
  if (isError(n)) return new SpreadsheetError(ERR.VALUE, 'Valore non convertibile in booleano');
  return n !== 0;
}

/** Formattazione "generale" di un numero: intero senza decimali, altrimenti compatto. */
export function formatGeneral(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-9 || abs >= 1e15)) {
    return n.toExponential(6).replace(/\.?0+e/, 'e');
  }
  // massimo 10 cifre significative, senza zeri finali inutili
  const rounded = Number(n.toPrecision(10));
  return String(rounded);
}

/**
 * Formattazione numerica con i formati supportati dalla ribbon.
 * I formattatori Intl sono memoizzati: crearli a ogni chiamata costerebbe
 * qualche centesimo di secondo per cella (e la griglia ne mostra centinaia).
 * @param {number} n
 * @param {string} formatId
 */
const FORMATTERS = new Map();

function formatter(options) {
  const key = JSON.stringify(options);
  let f = FORMATTERS.get(key);
  if (!f) {
    f = new Intl.NumberFormat('it-IT', options);
    FORMATTERS.set(key, f);
  }
  return f;
}

export function formatNumber(n, formatId = 'general') {
  if (!Number.isFinite(n)) return String(n);
  switch (formatId) {
    case 'int':
      return formatter({ maximumFractionDigits: 0 }).format(n);
    case 'dec2':
      return formatter({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    case 'thousands':
      return formatter({ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(n);
    case 'currency':
      return formatter({
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    case 'percent':
      return formatter({
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n / 100);
    case 'percent0':
      return formatter({ style: 'percent', maximumFractionDigits: 0 }).format(n / 100);
    case 'scientific':
      return n.toExponential(4).replace('.', ',');
    default:
      return formatGeneral(n);
  }
}

/** Confronta due valori per gli operatori relazionali. */
export function compareValues(a, b) {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) a = typeof b === 'string' ? '' : 0;
  if (isBlank(b)) b = typeof a === 'string' ? '' : 0;

  if (typeof a === 'string' || typeof b === 'string') {
    const na = isError(toNumber(a)) ? null : toNumber(a);
    const nb = isError(toNumber(b)) ? null : toNumber(b);
    if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
    const sa = toText(a).toLocaleUpperCase('it');
    const sb = toText(b).toLocaleUpperCase('it');
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const ba = toBoolean(a) ? 1 : 0;
    const bb = toBoolean(b) ? 1 : 0;
    return ba === bb ? 0 : ba < bb ? -1 : 1;
  }

  return a === b ? 0 : a < b ? -1 : 1;
}
