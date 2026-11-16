/**
 * engine.js
 * ---------------------------------------------------------------------------
 * Motore di calcolo e di gestione tabellare.
 *
 * Componenti:
 *   - archivio delle celle (input grezzo -> AST -> valore);
 *   - grafo delle dipendenze (quali formule dipendono da quali celle);
 *   - evaluator ricorsivo con rilevamento dei riferimenti circolari;
 *   - ricalcolo incrementale: alla modifica di una cella vengono ricalcolate
 *     solo le formule che dipendono (direttamente o indirettamente) da essa.
 *
 * La strategia di ricalcolo e' ibrida:
 *   1. "push"  : il grafo delle dipendenze individua l'insieme delle celle
 *                influenzate dalla modifica (indice spaziale a blocchi);
 *   2. "pull"  : il valore delle celle influenzate e' calcolato in modo
 *                ricorsivo con memoizzazione per passata di ricalcolo.
 *                Questo rende naturale il rilevamento dei cicli (stack di
 *                valutazione) e ricalcola solo il sottoalbero necessario.
 */

import {
  MAX_ROWS,
  MAX_COLS,
  HARD_MAX_ROWS,
  HARD_MAX_COLS,
  MIN_ROWS,
  MIN_COLS,
  cellKey,
  fromKey,
  cellName,
  colToLetters,
  parseCellRef,
} from './coordinates.js';
import { parseFormula, isFormula, NodeType, FormulaSyntaxError } from './parser.js';
import { resolveFunction } from './functions.js';
import {
  SpreadsheetError,
  ERR,
  RangeValue,
  isError,
  isBlank,
  toNumber,
  toText,
  toBoolean,
  formatNumber,
  compareValues,
} from './values.js';
import { transformFormulaText } from './formulaTransform.js';

/** Dimensione del blocco dell'indice spaziale (10x10 celle). */
const BLOCK = 10;

const blockIdOf = (r, c) => Math.floor(r / BLOCK) * 1000 + Math.floor(c / BLOCK);

/** Celle vuote: valore neutro. */
const EMPTY = null;

export class SheetEngine {
  /**
   * @param {{rows?:number, cols?:number}} [options]
   */
  constructor(options = {}) {
    this.rows = options.rows ?? MAX_ROWS;
    this.cols = options.cols ?? MAX_COLS;
    /** @type {Map<number, {raw:string, ast:object|null, value:any, style:object}>} */
    this.cells = new Map();
    /** Rettangoli referenziati da ciascuna formula: formulaKey -> Rect[] */
    this.formulaRects = new Map();
    /** Indice spaziale a blocchi: blockId -> Set<formulaKey> */
    this.blockIndex = new Map();
    /** Memoizzazione dei valori durante una passata di ricalcolo. */
    this.passCache = new Map();
    /** Versione incrementale: permette alla UI di sapere quando ridisegnare. */
    this.version = 0;
    /** Sink opzionale per il tracciamento dei passi di valutazione. */
    this.traceSink = null;
    /** Listener di cambio. */
    this.listeners = new Set();
  }

  /* ---------------------------------------------------------------- */
  /* Accesso alle celle                                               */
  /* ---------------------------------------------------------------- */

  /** @returns {{raw:string, ast:object|null, value:any, style:object}|undefined} */
  getCell(r, c) {
    return this.cells.get(cellKey(r, c));
  }

  /** Valore corrente (gia' calcolato) di una cella. */
  getValue(r, c) {
    const cell = this.cells.get(cellKey(r, c));
    return cell ? cell.value : EMPTY;
  }

  /** Valore grezzo inserito dall'utente. */
  getRaw(r, c) {
    const cell = this.cells.get(cellKey(r, c));
    return cell ? cell.raw : '';
  }

  /** Valore formattato pronto per la visualizzazione. */
  getDisplay(r, c) {
    const cell = this.cells.get(cellKey(r, c));
    const value = cell ? cell.value : EMPTY;
    return this.formatValue(value, cell?.style);
  }

  /**
   * Formatta un valore in base allo stile della cella.
   * @param {*} value
   * @param {object} [style]
   */
  formatValue(value, style) {
    if (isError(value)) return value.code;
    if (isBlank(value)) return '';
    if (typeof value === 'number') return formatNumber(value, style?.format ?? 'general');
    if (typeof value === 'boolean') return value ? 'VERO' : 'FALSO';
    return String(value);
  }

  /** Errore corrente della cella (null se non e' in errore). */
  getError(r, c) {
    const value = this.getValue(r, c);
    return isError(value) ? value : null;
  }

  /* ---------------------------------------------------------------- */
  /* Modifica del contenuto                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Imposta il contenuto grezzo di una cella e ricalcola le dipendenti.
   * @param {number} r
   * @param {number} c
   * @param {string} raw
   * @returns {number[]} chiavi delle celle il cui valore e' cambiato
   */
  setRaw(r, c, raw) {
    const key = cellKey(r, c);
    const text = String(raw ?? '');
    const cell = this.ensureCell(key);

    cell.raw = text;
    const parsed = this.parseContent(text);
    cell.ast = parsed.ast;
    cell.value = parsed.value;

    this.unregisterFormula(key);
    if (cell.ast) this.registerFormula(key, cell.ast);

    const changed = this.recompute([key]);
    this.version++;
    this.emit(changed);
    return changed;
  }

  /** Imposta (o modifica) lo stile di una cella. */
  setStyle(r, c, patch) {
    const cell = this.ensureCell(cellKey(r, c));
    cell.style = { ...cell.style, ...patch };
    this.version++;
    this.emit([cellKey(r, c)]);
  }

  /** Cancella il contenuto di una cella. */
  clear(r, c) {
    return this.setRaw(r, c, '');
  }

  /** Cancella l'intero foglio. */
  clearAll() {
    this.cells.clear();
    this.formulaRects.clear();
    this.blockIndex.clear();
    this.version++;
    this.emit([]);
  }

  /* ---------------------------------------------------------------- */
  /* Parsing del contenuto                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Distingue formula / numero / testo.
   * @param {string} raw
   * @returns {{ast:object|null, value:any}}
   */
  parseContent(raw) {
    const text = String(raw ?? '');
    const trimmed = text.trim();
    if (trimmed === '') return { ast: null, value: EMPTY };
    if (trimmed.startsWith('=')) {
      try {
        return { ast: parseFormula(trimmed), value: EMPTY };
      } catch (e) {
        const detail =
          e instanceof FormulaSyntaxError ? e.message : `Formula non valida: ${e?.message ?? e}`;
        return { ast: null, value: new SpreadsheetError(ERR.VALUE, detail) };
      }
    }
    const num = parseNumericLiteral(trimmed);
    if (num !== null) return { ast: null, value: num };
    return { ast: null, value: text };
  }

  /* ---------------------------------------------------------------- */
  /* Grafo delle dipendenze                                           */
  /* ---------------------------------------------------------------- */

  /** Raccoglie i rettangoli (celle singole incluse) citati da un AST. */
  collectRects(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    switch (node.type) {
      case NodeType.CELL:
        out.push({ r1: node.r, c1: node.c, r2: node.r, c2: node.c });
        break;
      case NodeType.RANGE:
        out.push({
          r1: node.rect.r1,
          c1: node.rect.c1,
          r2: node.rect.r2,
          c2: node.rect.c2,
        });
        break;
      case NodeType.BINOP:
        this.collectRects(node.left, out);
        this.collectRects(node.right, out);
        break;
      case NodeType.UNARY:
      case NodeType.POSTFIX:
        this.collectRects(node.operand, out);
        break;
      case NodeType.FUNC:
        for (const a of node.args) this.collectRects(a, out);
        break;
      default:
        break;
    }
    return out;
  }

  /** Registra una formula nell'indice delle dipendenze. */
  registerFormula(key, ast) {
    const rects = this.collectRects(ast);
    const clamped = rects.map((rect) => ({
      r1: Math.max(0, rect.r1),
      c1: Math.max(0, rect.c1),
      r2: Math.min(this.rows - 1, rect.r2),
      c2: Math.min(this.cols - 1, rect.c2),
    }));
    this.formulaRects.set(key, clamped);
    for (const rect of clamped) {
      for (let br = Math.floor(rect.r1 / BLOCK); br <= Math.floor(rect.r2 / BLOCK); br++) {
        for (let bc = Math.floor(rect.c1 / BLOCK); bc <= Math.floor(rect.c2 / BLOCK); bc++) {
          const id = br * 1000 + bc;
          let set = this.blockIndex.get(id);
          if (!set) {
            set = new Set();
            this.blockIndex.set(id, set);
          }
          set.add(key);
        }
      }
    }
  }

  /** Rimuove una formula dall'indice delle dipendenze. */
  unregisterFormula(key) {
    if (!this.formulaRects.has(key)) return;
    this.formulaRects.delete(key);
    for (const [id, set] of this.blockIndex) {
      if (set.delete(key) && set.size === 0) this.blockIndex.delete(id);
    }
  }

  /**
   * Formule che dipendono dalla cella indicata.
   * @param {number} key
   * @returns {number[]}
   */
  dependentsOf(key) {
    const { r, c } = fromKey(key);
    const set = this.blockIndex.get(blockIdOf(r, c));
    if (!set) return [];
    const out = [];
    for (const formulaKey of set) {
      const rects = this.formulaRects.get(formulaKey);
      if (!rects) continue;
      for (const rect of rects) {
        if (r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2) {
          out.push(formulaKey);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Insieme delle celle influenzate da una modifica (formula + dipendenti).
   * @param {number[]} seeds
   * @returns {Set<number>}
   */
  collectAffected(seeds) {
    const affected = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const key = queue.pop();
      for (const dep of this.dependentsOf(key)) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }
    return affected;
  }

  /* ---------------------------------------------------------------- */
  /* Ricalcolo                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Ricalcola le celle influenzate dalle celle indicate.
   * @param {number[]} seeds chiavi delle celle modificate
   * @returns {number[]} chiavi delle celle il cui valore e' cambiato
   */
  recompute(seeds) {
    this.passCache = new Map();
    const affected = this.collectAffected(seeds);
    const changed = [];
    for (const key of affected) {
      const before = this.cells.get(key)?.value;
      const value = this.evaluateCell(key, []);
      const cell = this.cells.get(key);
      if (cell) {
        cell.value = value;
        if (!sameValue(before, value)) changed.push(key);
      }
    }
    this.passCache = new Map();
    return changed;
  }

  /** Ricalcola l'intero foglio. */
  recalcAll() {
    const seeds = [];
    for (const [key, cell] of this.cells) {
      if (cell.ast) seeds.push(key);
    }
    const changed = this.recompute(seeds);
    this.version++;
    this.emit(changed);
    return changed;
  }

  /**
   * Valore di una cella, calcolandolo se necessario.
   * La pila `stack` serve a rilevare i riferimenti circolari.
   * @param {number} key
   * @param {number[]} stack
   */
  evaluateCell(key, stack) {
    if (this.passCache.has(key)) return this.passCache.get(key);

    const cell = this.cells.get(key);
    if (!cell || !cell.ast) {
      const v = cell ? cell.value : EMPTY;
      this.passCache.set(key, v);
      return v;
    }

    const idx = stack.indexOf(key);
    if (idx !== -1) {
      // Riferimento circolare: il ciclo e' stack[idx..end]
      const cycle = stack.slice(idx);
      const path = cycle.map((k) => {
        const p = fromKey(k);
        return cellName(p.r, p.c);
      });
      const err = new SpreadsheetError(
        ERR.REF,
        `Riferimento circolare: ${path.join(' → ')} → ${path[0]}`,
        true
      );
      for (const ck of cycle) {
        this.passCache.set(ck, err);
        const cc = this.cells.get(ck);
        if (cc) cc.value = err;
      }
      return err;
    }

    stack.push(key);
    const { r, c } = fromKey(key);
    let result;
    try {
      result = this.evaluateNode(cell.ast, stack, { r, c });
    } catch (e) {
      result =
        e instanceof SpreadsheetError
          ? e
          : new SpreadsheetError(ERR.VALUE, `Errore di calcolo: ${e?.message ?? e}`);
    }
    stack.pop();
    this.passCache.set(key, result);
    return result;
  }

  /**
   * Valutazione ricorsiva di un nodo dell'AST.
   * @param {object} node
   * @param {number[]} stack pila di valutazione (per i cicli)
   * @param {{r:number,c:number}} currentCell
   */
  evaluateNode(node, stack, currentCell) {
    if (!node) return EMPTY;
    if (this.traceSink) {
      this.traceSink.push({ node, value: undefined, currentCell });
    }

    let out;
    switch (node.type) {
      case NodeType.NUMBER:
        out = node.value;
        break;
      case NodeType.STRING:
        out = node.value;
        break;
      case NodeType.BOOL:
        out = node.value;
        break;
      case NodeType.ERROR:
        out = new SpreadsheetError(node.code, 'Errore costante nella formula');
        break;
      case NodeType.NAME:
        out = new SpreadsheetError(ERR.NAME, `Nome non riconosciuto: ${node.name}`);
        break;
      case NodeType.CELL: {
        if (node.r < 0 || node.c < 0 || node.r >= this.rows || node.c >= this.cols) {
          out = new SpreadsheetError(ERR.REF, `Riferimento fuori dalla griglia: ${cellName(node.r, node.c)}`);
        } else {
          out = this.evaluateCell(cellKey(node.r, node.c), stack);
        }
        break;
      }
      case NodeType.RANGE:
        out = new RangeValue(
          node.rect,
          (r, c) => this.getValue(r, c),
          { rows: this.rows, cols: this.cols }
        );
        break;
      case NodeType.BINOP:
        out = this.evaluateBinop(node, stack, currentCell);
        break;
      case NodeType.UNARY: {
        const v = this.evaluateNode(node.operand, stack, currentCell);
        if (isError(v)) {
          out = v;
        } else {
          const n = toNumber(v);
          out = isError(n)
            ? n
            : node.op === '-'
              ? -n
              : n;
        }
        break;
      }
      case NodeType.POSTFIX: {
        const v = this.evaluateNode(node.operand, stack, currentCell);
        if (isError(v)) {
          out = v;
        } else {
          const n = toNumber(v);
          out = isError(n) ? n : n / 100;
        }
        break;
      }
      case NodeType.FUNC:
        out = this.evaluateFunction(node, stack, currentCell);
        break;
      default:
        out = new SpreadsheetError(ERR.VALUE, 'Nodo non valido');
    }

    if (this.traceSink) {
      const last = this.traceSink[this.traceSink.length - 1];
      if (last && last.node === node) last.value = out;
    }
    return out;
  }

  /** Valutazione di un operatore binario. */
  evaluateBinop(node, stack, currentCell) {
    const left = this.evaluateNode(node.left, stack, currentCell);
    const right = this.evaluateNode(node.right, stack, currentCell);
    if (isError(left)) return left;
    if (isError(right)) return right;

    switch (node.op) {
      case '&':
        return toText(left) + toText(right);
      case '=':
        return compareValues(left, right) === 0;
      case '<>':
        return compareValues(left, right) !== 0;
      case '<':
        return compareValues(left, right) < 0;
      case '>':
        return compareValues(left, right) > 0;
      case '<=':
        return compareValues(left, right) <= 0;
      case '>=':
        return compareValues(left, right) >= 0;
      default: {
        const a = toNumber(left);
        const b = toNumber(right);
        if (isError(a)) return a;
        if (isError(b)) return b;
        switch (node.op) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            if (b === 0) return new SpreadsheetError(ERR.DIV0, 'Divisione per zero');
            return a / b;
          case '^': {
            if (a < 0 && !Number.isInteger(b)) {
              return new SpreadsheetError(ERR.NUM, 'Potenza di un numero negativo con esponente non intero');
            }
            const res = Math.pow(a, b);
            if (!Number.isFinite(res)) {
              return new SpreadsheetError(ERR.NUM, 'Risultato non finito');
            }
            return res;
          }
          default:
            return new SpreadsheetError(ERR.VALUE, `Operatore sconosciuto: ${node.op}`);
        }
      }
    }
  }

  /** Valutazione di una chiamata a funzione. */
  evaluateFunction(node, stack, currentCell) {
    const def = resolveFunction(node.name);
    if (!def) {
      return new SpreadsheetError(ERR.NAME, `Funzione sconosciuta: ${node.name}`);
    }
    if (node.args.length < def.minArgs) {
      return new SpreadsheetError(
        ERR.VALUE,
        `${def.name} richiede almeno ${def.minArgs} argomento/i`
      );
    }
    if (node.args.length > def.maxArgs) {
      return new SpreadsheetError(
        ERR.VALUE,
        `${def.name} accetta al massimo ${def.maxArgs} argomento/i`
      );
    }

    const ctx = {
      engine: this,
      currentCell,
      evaluate: (n) => this.evaluateNode(n, stack, currentCell),
    };

    try {
      if (def.lazy) {
        return def.fn(node.args, ctx);
      }
      const values = node.args.map((a) => this.evaluateNode(a, stack, currentCell));
      return def.fn(values, ctx);
    } catch (e) {
      return e instanceof SpreadsheetError
        ? e
        : new SpreadsheetError(ERR.VALUE, `${def.name}: ${e?.message ?? e}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Operazioni strutturali: righe e colonne                           */
  /* ---------------------------------------------------------------- */

  /**
   * Inserisce righe a partire dalla posizione indicata (0-based).
   * I riferimenti delle formule vengono spostati come in Excel.
   */
  insertRows(at, count = 1) {
    const canInsert = Math.min(count, HARD_MAX_ROWS - this.rows);
    if (canInsert <= 0) return false;
    const next = new Map();
    for (const [key, cell] of this.cells) {
      const { r, c } = fromKey(key);
      if (r >= at) {
        const raw = transformFormulaText(cell.raw, { rowFrom: at, rowDelta: canInsert });
        next.set(cellKey(r + canInsert, c), { ...cell, raw });
      } else {
        next.set(key, cell);
      }
    }
    this.cells = next;
    this.rows += canInsert;
    this.rebuildIndex();
    return true;
  }

  /** Elimina righe (le formule che le referenziano diventano #RIF!). */
  deleteRows(at, count = 1) {
    if (this.rows - count < MIN_ROWS) return false;
    const next = new Map();
    for (const [key, cell] of this.cells) {
      const { r, c } = fromKey(key);
      if (r >= at && r < at + count) continue; // cella eliminata
      if (r >= at + count) {
        const raw = transformFormulaText(cell.raw, { rowFrom: at + count, rowDelta: -count });
        next.set(cellKey(r - count, c), { ...cell, raw });
      } else {
        next.set(key, cell);
      }
    }
    this.cells = next;
    this.rows -= count;
    this.rebuildIndex();
    return true;
  }

  /** Inserisce colonne a partire dalla posizione indicata (0-based). */
  insertCols(at, count = 1) {
    const canInsert = Math.min(count, HARD_MAX_COLS - this.cols);
    if (canInsert <= 0) return false;
    const next = new Map();
    for (const [key, cell] of this.cells) {
      const { r, c } = fromKey(key);
      if (c >= at) {
        const raw = transformFormulaText(cell.raw, { colFrom: at, colDelta: canInsert });
        next.set(cellKey(r, c + canInsert), { ...cell, raw });
      } else {
        next.set(key, cell);
      }
    }
    this.cells = next;
    this.cols += canInsert;
    this.rebuildIndex();
    return true;
  }

  /** Elimina colonne. */
  deleteCols(at, count = 1) {
    if (this.cols - count < MIN_COLS) return false;
    const next = new Map();
    for (const [key, cell] of this.cells) {
      const { r, c } = fromKey(key);
      if (c >= at && c < at + count) continue;
      if (c >= at + count) {
        const raw = transformFormulaText(cell.raw, { colFrom: at + count, colDelta: -count });
        next.set(cellKey(r, c - count), { ...cell, raw });
      } else {
        next.set(key, cell);
      }
    }
    this.cells = next;
    this.cols -= count;
    this.rebuildIndex();
    return true;
  }

  /** Ricostruisce l'indice delle dipendenze e ricalcola tutto. */
  rebuildIndex() {
    this.formulaRects.clear();
    this.blockIndex.clear();
    for (const [key, cell] of this.cells) {
      if (cell.ast) {
        // La formula puo' essere cambiata dalla trasformazione: la riparsiamo.
        const parsed = this.parseContent(cell.raw);
        cell.ast = parsed.ast;
        if (!parsed.ast && parsed.value !== EMPTY) cell.value = parsed.value;
        if (cell.ast) this.registerFormula(key, cell.ast);
      }
    }
    this.recalcAll();
  }

  /* ---------------------------------------------------------------- */
  /* Serializzazione                                                   */
  /* ---------------------------------------------------------------- */

  /** Esporta il foglio in un oggetto JSON-serializzabile. */
  toJSON() {
    const cells = [];
    for (const [key, cell] of this.cells) {
      if (cell.raw === '' && !cell.style.bold && !cell.style.italic && !cell.style.align && !cell.style.format) {
        continue;
      }
      const { r, c } = fromKey(key);
      cells.push({ r, c, raw: cell.raw, style: cell.style });
    }
    return {
      version: 1,
      rows: this.rows,
      cols: this.cols,
      cells,
    };
  }

  /** Carica un foglio da una struttura JSON. */
  fromJSON(data) {
    this.cells.clear();
    this.formulaRects.clear();
    this.blockIndex.clear();
    this.rows = Math.min(Math.max(data?.rows ?? MAX_ROWS, MIN_ROWS), HARD_MAX_ROWS);
    this.cols = Math.min(Math.max(data?.cols ?? MAX_COLS, MIN_COLS), HARD_MAX_COLS);
    for (const item of data?.cells ?? []) {
      const r = item.r;
      const c = item.c;
      if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
      const key = cellKey(r, c);
      const cell = this.ensureCell(key);
      cell.raw = item.raw ?? '';
      const parsed = this.parseContent(cell.raw);
      cell.ast = parsed.ast;
      cell.value = parsed.value;
      cell.style = { ...cell.style, ...(item.style ?? {}) };
      if (cell.ast) this.registerFormula(key, cell.ast);
    }
    this.recalcAll();
    this.version++;
    this.emit([]);
  }

  /** Celle utilizzate (per l'esportazione CSV). */
  getUsedRange() {
    let maxR = 0;
    let maxC = 0;
    let found = false;
    for (const [key, cell] of this.cells) {
      if (cell.raw === '') continue;
      const { r, c } = fromKey(key);
      found = true;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    return found ? { rows: maxR + 1, cols: maxC + 1 } : { rows: 0, cols: 0 };
  }

  /* ---------------------------------------------------------------- */
  /* Utilita' interne                                                  */
  /* ---------------------------------------------------------------- */

  ensureCell(key) {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { raw: '', ast: null, value: EMPTY, style: {} };
      this.cells.set(key, cell);
    }
    if (!cell.style) cell.style = {};
    return cell;
  }

  /** Registra un listener di cambio. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(changed) {
    for (const fn of this.listeners) {
      try {
        fn(changed);
      } catch (e) {
        console.error('[engine] listener fallito', e);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

/** Confronto tra valori (usato per capire se una cella e' cambiata). */
function sameValue(a, b) {
  if (a === b) return true;
  if (isError(a) && isError(b)) return a.code === b.code && a.detail === b.detail;
  if (a === null || a === undefined) return b === null || b === undefined;
  return false;
}

/**
 * Interpreta un testo come numero (formato italiano o inglese).
 * @returns {number|null}
 */
export function parseNumericLiteral(text) {
  const t = String(text).trim();
  if (t === '') return null;
  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
  if (/^[+-]?\d+,\d+$/.test(t)) return parseFloat(t.replace(',', '.'));
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  }
  if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) return parseInt(t.replace(/\./g, ''), 10);
  return null;
}

export { MAX_ROWS, MAX_COLS, HARD_MAX_ROWS, HARD_MAX_COLS, MIN_ROWS, MIN_COLS };
