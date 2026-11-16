/**
 * functions.js
 * ---------------------------------------------------------------------------
 * Registro delle funzioni di foglio di calcolo.
 *
 * Ogni funzione e' descritta da un oggetto:
 *   {
 *     name        : nome canonico in italiano ("SOMMA")
 *     aliases     : nomi alternativi ("SUM", "SOMMA_PRODOTTO")
 *     signature   : firma mostrata nella guida
 *     description : descrizione mostrata nella guida
 *     category    : gruppo nella guida
 *     minArgs     : numero minimo di argomenti
 *     maxArgs     : numero massimo di argomenti (Infinity)
 *     lazy        : se true la funzione riceve l'AST degli argomenti e puo'
 *                   valutarli in modo pigro (cortocircuito: SE, SE.ERRORE)
 *     fn          : implementazione
 *   }
 *
 * Gli argomenti delle funzioni normali sono gia' valutati; le funzioni `lazy`
 * ricevono i nodi AST e possono chiamare `ctx.evaluate(node)`.
 */

import {
  SpreadsheetError,
  ERR,
  RangeValue,
  isError,
  isBlank,
  toNumber,
  toText,
  toBoolean,
  formatGeneral,
} from './values.js';
import {
  sin, cos, tan, asin, acos, atan,
  sinh, cosh, tanh,
  sqrt as msqrt, cbrt, exp as mexp, abs as mabs, sign, hypot, pow as mpow,
  factorial, gcd, lcm,
} from 'mathjs';
import dayjs from 'dayjs';

/* ------------------------------------------------------------------ */
/* Helper interni                                                      */
/* ------------------------------------------------------------------ */

const isNumericString = (s) => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(String(s).trim());

/** Confronta un valore di cella con un criterio tipo Excel (">5", "testo", ...). */
export function matchCriteria(value, crit) {
  if (isError(value)) return false;
  const { op, target } = crit;

  if (op === '=' && target === '') return isBlank(value);
  if (isBlank(value)) return false;

  if (typeof target === 'number') {
    let n = null;
    if (typeof value === 'number') n = value;
    else if (typeof value === 'string' && isNumericString(value)) n = parseFloat(value);
    else if (typeof value === 'boolean') n = value ? 1 : 0;
    if (n === null) return false;
    switch (op) {
      case '>': return n > target;
      case '<': return n < target;
      case '>=': return n >= target;
      case '<=': return n <= target;
      case '=': return n === target;
      case '<>': return n !== target;
      default: return false;
    }
  }

  if (typeof target === 'boolean') {
    const b = toBoolean(value);
    if (isError(b)) return false;
    switch (op) {
      case '=': return b === target;
      case '<>': return b !== target;
      case '>': return b === true && target === false;
      case '<': return b === false && target === true;
      default: return false;
    }
  }

  // target testuale: confronto case-insensitive con supporto ai jolly * e ?
  const text = toText(value).toLocaleUpperCase('it');
  const pat = String(target).toLocaleUpperCase('it');
  const eq = globMatch(text, pat);
  switch (op) {
    case '=': return eq;
    case '<>': return !eq;
    case '>': return text > pat;
    case '<': return text < pat;
    case '>=': return text >= pat;
    case '<=': return text <= pat;
    default: return false;
  }
}

/** Confronto con jolly tipo Excel: "pro*" / "a?c". */
export function globMatch(text, pattern) {
  const re = new RegExp(
    '^' +
      String(pattern)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
  return re.test(text);
}

/** Parsing di un criterio: ">=5" -> {op:'>=', target:5}, "abc" -> {op:'=', target:'abc'}. */
export function parseCriteria(raw) {
  if (isError(raw)) return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return { op: '=', target: raw };
  }
  const text = String(raw ?? '').trim();
  const m = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(text);
  if (m) {
    const op = m[1];
    const body = m[2].trim();
    if (body === '') return { op: op === '<>' ? '<>' : '=', target: '' };
    if (isNumericString(body)) return { op, target: parseFloat(body.replace(',', '.')) };
    if (body.toUpperCase() === 'VERO' || body.toUpperCase() === 'FALSO') {
      return { op, target: body.toUpperCase() === 'VERO' };
    }
    return { op, target: body };
  }
  if (isNumericString(text)) return { op: '=', target: parseFloat(text.replace(',', '.')) };
  if (text.toUpperCase() === 'VERO' || text.toUpperCase() === 'FALSO') {
    return { op: '=', target: text.toUpperCase() === 'VERO' };
  }
  return { op: '=', target: text };
}

/** Raccoglie i numeri utili per una funzione aggregata. */
function collectNumbers(args) {
  const out = [];
  for (const a of args) {
    if (isError(a)) throw a;
    if (a instanceof RangeValue) {
      // Nelle matrici Excel ignora testo, booleano e celle vuote.
      for (const { value } of a.values()) {
        if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
      }
    } else if (isBlank(a)) {
      // argomento vuoto: ignorato
    } else if (typeof a === 'boolean') {
      out.push(a ? 1 : 0);
    } else if (typeof a === 'number') {
      if (Number.isFinite(a)) out.push(a);
    } else if (typeof a === 'string') {
      const n = toNumber(a);
      if (isError(n)) throw n;
      out.push(n);
    }
  }
  return out;
}

/** Trova, tra gli argomenti, quello che e' il criterio (stringa o numero). */
function splitConditionalArgs(args) {
  // args: [intervalloCriterio, criterio, (intervalloValori)]
  let criterionIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a instanceof RangeValue) continue;
    if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') {
      criterionIndex = i;
      break;
    }
  }
  if (criterionIndex === -1) {
    throw new SpreadsheetError(ERR.VALUE, 'Criterio non valido');
  }
  const criterion = args[criterionIndex];
  const ranges = args.filter((a) => a instanceof RangeValue);
  if (ranges.length === 0) {
    throw new SpreadsheetError(ERR.VALUE, 'Intervallo non valido');
  }
  return { criterion, ranges };
}

/** Esegue una funzione condizionale su un intervallo. */
function conditionalAggregate(args, mode) {
  if (isError(args[0])) return args[0];
  const { criterion, ranges } = splitConditionalArgs(args);
  const crit = parseCriteria(criterion);
  if (isError(crit)) return crit;

  const criteriaRange = ranges[0];
  const valueRange = ranges[1] ?? ranges[0];

  const critCells = [...criteriaRange.values()];
  const valueCells = [...valueRange.values()];
  const n = Math.min(critCells.length, valueCells.length);

  let count = 0;
  let sum = 0;
  let sumCount = 0;
  for (let i = 0; i < n; i++) {
    if (!matchCriteria(critCells[i].value, crit)) continue;
    count++;
    const v = valueCells[i].value;
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      sumCount++;
    }
  }

  if (mode === 'count') return count;
  if (mode === 'sum') return sum;
  if (mode === 'average') {
    if (sumCount === 0) throw new SpreadsheetError(ERR.DIV0, 'Nessun valore numerico da mediare');
    return sum / sumCount;
  }
  return count;
}

/** Avvolge le chiamate a math.js trasformando le eccezioni in #NUM!. */
function mathCall(fn) {
  try {
    const out = fn();
    if (typeof out === 'number' && !Number.isFinite(out)) {
      return new SpreadsheetError(ERR.NUM, 'Risultato non finito');
    }
    return out;
  } catch (e) {
    return new SpreadsheetError(ERR.NUM, e?.message ? String(e.message) : 'Operazione non valida');
  }
}

function requireNumbers(args, count) {
  const nums = [];
  for (const a of args) {
    if (isError(a)) return a;
    const n = toNumber(a);
    if (isError(n)) return n;
    nums.push(n);
  }
  if (nums.length < count) {
    return new SpreadsheetError(ERR.VALUE, 'Numero di argomenti insufficiente');
  }
  return nums;
}

/* ------------------------------------------------------------------ */
/* Definizioni                                                         */
/* ------------------------------------------------------------------ */

/** @type {Array<object>} */
const DEFS = [];

function register(def) {
  DEFS.push({
    minArgs: 1,
    maxArgs: Infinity,
    aliases: [],
    category: 'Generale',
    lazy: false,
    ...def,
  });
}

/* --- Statistiche --------------------------------------------------- */

register({
  name: 'SOMMA',
  aliases: ['SUM'],
  signature: 'SOMMA(numero1; [numero2]; ...)',
  description:
    'Somma tutti i numeri. Nelle matrici il testo e le celle vuote vengono ignorate.',
  category: 'Statistica',
  fn(args) {
    try {
      return collectNumbers(args).reduce((a, b) => a + b, 0);
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'MEDIA',
  aliases: ['AVERAGE', 'AVERAGEIF'],
  signature: 'MEDIA(numero1; [numero2]; ...)',
  description: 'Media aritmetica dei numeri. Le celle non numeriche vengono ignorate.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args);
      if (nums.length === 0) {
        return new SpreadsheetError(ERR.DIV0, 'Nessun valore numerico da mediare');
      }
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'CONTA',
  aliases: ['COUNT'],
  signature: 'CONTA(numero1; [numero2]; ...)',
  description: 'Conta le celle contenenti numeri.',
  category: 'Statistica',
  fn(args) {
    let count = 0;
    for (const a of args) {
      if (isError(a)) return a;
      if (a instanceof RangeValue) {
        for (const { value } of a.values()) {
          if (typeof value === 'number' && Number.isFinite(value)) count++;
        }
      } else if (typeof a === 'number' && Number.isFinite(a)) {
        count++;
      }
    }
    return count;
  },
});

register({
  name: 'CONTA.VALORI',
  aliases: ['COUNTA'],
  signature: 'CONTA.VALORI(valore1; [valore2]; ...)',
  description: 'Conta le celle non vuote (numeri, testo, booleano, errori).',
  category: 'Statistica',
  fn(args) {
    let count = 0;
    for (const a of args) {
      if (a instanceof RangeValue) {
        for (const { value } of a.values()) {
          if (!isBlank(value)) count++;
        }
      } else if (!isBlank(a)) {
        count++;
      }
    }
    return count;
  },
});

register({
  name: 'SOMMA.SE',
  aliases: ['SUMIF'],
  signature: 'SOMMA.SE(intervallo; criterio; [intervallo_somma])',
  description: 'Suma i valori che soddisfano il criterio (es. ">5").',
  category: 'Statistica',
  example: '=SOMMA.SE(A1:A10;">5")',
  fn(args) {
    try {
      return conditionalAggregate(args, 'sum');
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'CONTA.SE',
  aliases: ['COUNTIF'],
  signature: 'CONTA.SE(intervallo; criterio)',
  description: 'Conta le celle che soddisfano il criterio.',
  category: 'Statistica',
  example: '=CONTA.SE(A1:A10;">5")',
  fn(args) {
    try {
      return conditionalAggregate(args, 'count');
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'MEDIA.SE',
  aliases: ['AVERAGEIF'],
  signature: 'MEDIA.SE(intervallo; criterio; [intervallo_media])',
  description: 'Media dei valori che soddisfano il criterio.',
  category: 'Statistica',
  example: '=MEDIA.SE(A1:A10;">5")',
  fn(args) {
    try {
      return conditionalAggregate(args, 'average');
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'MAX',
  aliases: ['MAXA'],
  signature: 'MAX(numero1; [numero2]; ...)',
  description: 'Il valore numerico piu\' grande.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args);
      if (!nums.length) return 0;
      return Math.max(...nums);
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'MIN',
  aliases: ['MINA'],
  signature: 'MIN(numero1; [numero2]; ...)',
  description: 'Il valore numerico piu\' piccolo.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args);
      if (!nums.length) return 0;
      return Math.min(...nums);
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'GRANDE',
  aliases: ['LARGE'],
  signature: 'GRANDE(matrice; k)',
  description: 'Il k-esimo valore piu\' grande.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args);
      const k = toNumber(args[1]);
      if (isError(k)) return k;
      if (k < 1 || k > nums.length) return new SpreadsheetError(ERR.NUM, 'k fuori intervallo');
      nums.sort((a, b) => b - a);
      return nums[Math.floor(k) - 1];
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'PICCOLO',
  aliases: ['SMALL'],
  signature: 'PICCOLO(matrice; k)',
  description: 'Il k-esimo valore piu\' piccolo.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args);
      const k = toNumber(args[1]);
      if (isError(k)) return k;
      if (k < 1 || k > nums.length) return new SpreadsheetError(ERR.NUM, 'k fuori intervallo');
      nums.sort((a, b) => a - b);
      return nums[Math.floor(k) - 1];
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

register({
  name: 'SOMMA.PRODOTTO',
  aliases: ['SUMPRODUCT'],
  signature: 'SOMMA.PRODOTTO(matrice1; [matrice2]; ...)',
  description: 'Somma i prodotti element-wise delle matrici.',
  category: 'Statistica',
  fn(args) {
    const ranges = args.filter((a) => a instanceof RangeValue);
    if (!ranges.length) return new SpreadsheetError(ERR.VALUE, 'Sono necessarie matrici');
    const cols = ranges.map((r) => [...r.values()].map((c) => c.value));
    const len = Math.min(...cols.map((c) => c.length));
    let total = 0;
    for (let i = 0; i < len; i++) {
      let prod = 1;
      for (const col of cols) {
        const v = col[i];
        prod *= typeof v === 'number' ? v : 0;
      }
      total += prod;
    }
    return total;
  },
});

register({
  name: 'MEDIANA',
  aliases: ['MEDIAN'],
  signature: 'MEDIANA(numero1; [numero2]; ...)',
  description: 'Valore centrale di un insieme di numeri.',
  category: 'Statistica',
  fn(args) {
    try {
      const nums = collectNumbers(args).sort((a, b) => a - b);
      if (!nums.length) return new SpreadsheetError(ERR.NUM, 'Nessun valore');
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    } catch (e) {
      return e instanceof SpreadsheetError ? e : new SpreadsheetError(ERR.VALUE, String(e));
    }
  },
});

/* --- Logica -------------------------------------------------------- */

register({
  name: 'SE',
  aliases: ['IF'],
  signature: 'SE(condizione; [valore_se_vero]; [valore_se_falso])',
  description: 'Restituisce un valore a seconda che la condizione sia vera o falsa.',
  category: 'Logica',
  lazy: true,
  fn(argNodes, ctx) {
    if (!argNodes.length) return new SpreadsheetError(ERR.VALUE, 'SE richiede almeno una condizione');
    const cond = ctx.evaluate(argNodes[0]);
    if (isError(cond)) return cond;
    const truthy = toBoolean(cond);
    if (isError(truthy)) return truthy;
    if (truthy) {
      return argNodes.length > 1 ? ctx.evaluate(argNodes[1]) : true;
    }
    return argNodes.length > 2 ? ctx.evaluate(argNodes[2]) : false;
  },
});

register({
  name: 'SE.ERRORE',
  aliases: ['IFERROR'],
  signature: 'SE.ERRORE(valore; valore_in_caso_di_errore)',
  description: 'Sostituisce un errore con un valore alternativo.',
  category: 'Logica',
  lazy: true,
  fn(argNodes, ctx) {
    if (!argNodes.length) return new SpreadsheetError(ERR.VALUE, 'SE.ERRORE richiede un valore');
    const v = ctx.evaluate(argNodes[0]);
    if (isError(v)) {
      return argNodes.length > 1 ? ctx.evaluate(argNodes[1]) : v;
    }
    return v;
  },
});

register({
  name: 'ÈERRORE',
  aliases: ['ISERROR', 'ISERR'],
  signature: 'ÈERRORE(valore)',
  description: 'VERO se il valore e\' un errore.',
  category: 'Logica',
  lazy: true,
  fn(argNodes, ctx) {
    if (!argNodes.length) return new SpreadsheetError(ERR.VALUE, 'ÈERRORE richiede un valore');
    return isError(ctx.evaluate(argNodes[0]));
  },
});

register({
  name: 'E',
  aliases: ['AND'],
  signature: 'E(logico1; [logico2]; ...)',
  description: 'VERO se tutti gli argomenti sono veri.',
  category: 'Logica',
  fn(args) {
    for (const a of args) {
      if (isError(a)) return a;
      const b = toBoolean(a);
      if (isError(b)) return b;
      if (!b) return false;
    }
    return true;
  },
});

register({
  name: 'O',
  aliases: ['OR'],
  signature: 'O(logico1; [logico2]; ...)',
  description: 'VERO se almeno un argomento e\' vero.',
  category: 'Logica',
  fn(args) {
    for (const a of args) {
      if (isError(a)) return a;
      const b = toBoolean(a);
      if (isError(b)) return b;
      if (b) return true;
    }
    return false;
  },
});

register({
  name: 'NON',
  aliases: ['NOT'],
  signature: 'NON(logico)',
  description: 'Inverte il valore logico.',
  category: 'Logica',
  fn(args) {
    const b = toBoolean(args[0]);
    if (isError(b)) return b;
    return !b;
  },
});

/* --- Testo --------------------------------------------------------- */

register({
  name: 'CONCAT',
  aliases: ['CONCATENATE', 'CONCATENAZIONE'],
  signature: 'CONCAT(testo1; [testo2]; ...)',
  description: 'Concatena i valori in un unico testo.',
  category: 'Testo',
  fn(args) {
    let out = '';
    for (const a of args) {
      if (isError(a)) return a;
      if (a instanceof RangeValue) {
        for (const { value } of a.values()) {
          if (!isBlank(value)) out += toText(value);
        }
      } else if (!isBlank(a)) {
        out += toText(a);
      }
    }
    return out;
  },
});

register({
  name: 'LUNGEZZA',
  aliases: ['LEN'],
  signature: 'LUNGEZZA(testo)',
  description: 'Numero di caratteri di un testo.',
  category: 'Testo',
  fn(args) {
    const t = toText(args[0]);
    if (isError(t)) return t;
    return t.length;
  },
});

register({
  name: 'MAIUSC',
  aliases: ['UPPER'],
  signature: 'MAIUSC(testo)',
  description: 'Converte il testo in maiuscolo.',
  category: 'Testo',
  fn(args) {
    const t = toText(args[0]);
    if (isError(t)) return t;
    return t.toLocaleUpperCase('it');
  },
});

register({
  name: 'MINUSC',
  aliases: ['LOWER'],
  signature: 'MINUSC(testo)',
  description: 'Converte il testo in minuscolo.',
  category: 'Testo',
  fn(args) {
    const t = toText(args[0]);
    if (isError(t)) return t;
    return t.toLocaleLowerCase('it');
  },
});

register({
  name: 'TROVA',
  aliases: ['FIND', 'SEARCH'],
  signature: 'TROVA(testo_cercato; testo)',
  description: 'Posizione di una sottostringa (1 se non trovata).',
  category: 'Testo',
  fn(args) {
    const needle = toText(args[0]);
    const hay = toText(args[1]);
    if (isError(needle)) return needle;
    if (isError(hay)) return hay;
    const idx = hay.toLocaleUpperCase('it').indexOf(needle.toLocaleUpperCase('it'));
    return idx === -1 ? 0 : idx + 1;
  },
});

/* --- Matematica ---------------------------------------------------- */

register({
  name: 'POTENZA',
  aliases: ['POWER'],
  signature: 'POTENZA(base; esponente)',
  description: 'Eleva la base all\'esponente.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 2);
    if (isError(n)) return n;
    return mathCall(() => mpow(n[0], n[1]));
  },
});

register({
  name: 'RADQ',
  aliases: ['SQRT', 'RADICE'],
  signature: 'RADQ(numero)',
  description: 'Radice quadrata.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => msqrt(n[0]));
  },
});

register({
  name: 'ASSOLUTO',
  aliases: ['ABS'],
  signature: 'ASSOLUTO(numero)',
  description: 'Valore assoluto.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => mabs(n[0]));
  },
});

register({
  name: 'ARROTONDA',
  aliases: ['ROUND'],
  signature: 'ARROTONDA(numero; [decimali])',
  description: 'Arrotonda un numero a un numero di decimali specificato.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    const digits = args.length > 1 ? toNumber(args[1]) : 0;
    if (isError(digits)) return digits;
    const factor = Math.pow(10, Math.trunc(digits));
    // arrotondamento "metà lontano dallo zero" come in Excel
    const scaled = n[0] * factor;
    const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
    return rounded / factor;
  },
});

register({
  name: 'TRONCA',
  aliases: ['TRUNC'],
  signature: 'TRONCA(numero; [decimali])',
  description: 'Tronca un numero rimuovendo la parte decimale.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    const digits = args.length > 1 ? toNumber(args[1]) : 0;
    if (isError(digits)) return digits;
    const factor = Math.pow(10, Math.trunc(digits));
    return Math.trunc(n[0] * factor) / factor;
  },
});

register({
  name: 'INT',
  aliases: ['INT'],
  signature: 'INT(numero)',
  description: 'Arrotonda per difetto all\'intero piu\' vicino.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return Math.floor(n[0]);
  },
});

register({
  name: 'ARROONDA.SOPRA',
  aliases: ['CEILING', 'CEILING.MATH'],
  signature: 'ARROONDA.SOPRA(numero; [multiplo])',
  description: 'Arrotonda per eccesso al multiplo specificato.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    const step = args.length > 1 ? toNumber(args[1]) : 1;
    if (isError(step)) return step;
    if (step === 0) return 0;
    return Math.ceil(n[0] / step) * step;
  },
});

register({
  name: 'ARROONDA.SOTTO',
  aliases: ['FLOOR'],
  signature: 'ARROONDA.SOTTO(numero; [multiplo])',
  description: 'Arrotonda per difetto al multiplo specificato.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    const step = args.length > 1 ? toNumber(args[1]) : 1;
    if (isError(step)) return step;
    if (step === 0) return 0;
    return Math.floor(n[0] / step) * step;
  },
});

register({
  name: 'MODULO',
  aliases: ['MOD', 'RESTO'],
  signature: 'MODULO(numero; divisore)',
  description: 'Resto della divisione.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 2);
    if (isError(n)) return n;
    if (n[1] === 0) return new SpreadsheetError(ERR.DIV0, 'Divisione per zero');
    return n[0] % n[1];
  },
});

register({
  name: 'SEGNO',
  aliases: ['SIGN'],
  signature: 'SEGNO(numero)',
  description: 'Restituisce -1, 0 o 1 secondo il segno.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => sign(n[0]));
  },
});

register({
  name: 'PI',
  aliases: ['PI'],
  signature: 'PI()',
  description: 'Il valore di pi greco.',
  category: 'Matematica',
  minArgs: 0,
  fn() {
    return Math.PI;
  },
});

register({
  name: 'SENO',
  aliases: ['SIN'],
  signature: 'SENO(angolo)',
  description: 'Seno dell\'angolo in radianti.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => sin(n[0]));
  },
});

register({
  name: 'COSENO',
  aliases: ['COS'],
  signature: 'COSENO(angolo)',
  description: 'Coseno dell\'angolo in radianti.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => cos(n[0]));
  },
});

register({
  name: 'TANGENTE',
  aliases: ['TAN'],
  signature: 'TANGENTE(angolo)',
  description: 'Tangente dell\'angolo in radianti.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => tan(n[0]));
  },
});

register({
  name: 'ARCSEN',
  aliases: ['ASIN'],
  signature: 'ARCSEN(numero)',
  description: 'Arcseno (risultato in radianti).',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => asin(n[0]));
  },
});

register({
  name: 'ARCCOS',
  aliases: ['ACOS'],
  signature: 'ARCCOS(numero)',
  description: 'Arccoseno (risultato in radianti).',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => acos(n[0]));
  },
});

register({
  name: 'ARCTAN',
  aliases: ['ATAN'],
  signature: 'ARCTAN(numero)',
  description: 'Arctangente (risultato in radianti).',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => atan(n[0]));
  },
});

register({
  name: 'SENOIDALE',
  aliases: ['SINH'],
  signature: 'SENOIDALE(numero)',
  description: 'Seno iperbolico.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => sinh(n[0]));
  },
});

register({
  name: 'COSENOIDALE',
  aliases: ['COSH'],
  signature: 'COSENOIDALE(numero)',
  description: 'Coseno iperbolico.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => cosh(n[0]));
  },
});

register({
  name: 'TANGENTEIDALE',
  aliases: ['TANH'],
  signature: 'TANGENTEIDALE(numero)',
  description: 'Tangente iperbolica.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => tanh(n[0]));
  },
});

register({
  name: 'ESP',
  aliases: ['EXP'],
  signature: 'ESP(numero)',
  description: 'e elevato alla potenza indicata.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => mexp(n[0]));
  },
});

register({
  name: 'LN',
  aliases: ['LN'],
  signature: 'LN(numero)',
  description: 'Logaritmo naturale.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => log(n[0]));
  },
});

register({
  name: 'LOG',
  aliases: ['LOG10'],
  signature: 'LOG(numero; [base])',
  description: 'Logaritmo in base 10 (o nella base indicata).',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    const base = args.length > 1 ? toNumber(args[1]) : 10;
    if (isError(base)) return base;
    return mathCall(() => Math.log(n[0]) / Math.log(base));
  },
});

register({
  name: 'GRADI',
  aliases: ['DEGREES'],
  signature: 'GRADI(radianti)',
  description: 'Converte i radianti in gradi.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return (n[0] * 180) / Math.PI;
  },
});

register({
  name: 'RADIANI',
  aliases: ['RADIANS'],
  signature: 'RADIANI(gradi)',
  description: 'Converte i gradi in radianti.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return (n[0] * Math.PI) / 180;
  },
});

register({
  name: 'FATTORIALE',
  aliases: ['FACT'],
  signature: 'FATTORIALE(numero)',
  description: 'Fattoriale di un intero non negativo.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => factorial(n[0]));
  },
});

register({
  name: 'MCD',
  aliases: ['GCD'],
  signature: 'MCD(numero1; [numero2]; ...)',
  description: 'Massimo comune divisore.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => n.reduce((acc, v) => gcd(acc, v)));
  },
});

register({
  name: 'MCM',
  aliases: ['LCM'],
  signature: 'MCM(numero1; [numero2]; ...)',
  description: 'Minimo comune multiplo.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => n.reduce((acc, v) => lcm(acc, v)));
  },
});

register({
  name: 'IPOTENUSA',
  aliases: ['HYPOT'],
  signature: 'IPOTENUSA(numero1; [numero2]; ...)',
  description: 'Ipotenusa di un triangolo rettangolo.',
  category: 'Matematica',
  fn(args) {
    const n = requireNumbers(args, 1);
    if (isError(n)) return n;
    return mathCall(() => hypot(...n));
  },
});

/* --- Data (day.js) ------------------------------------------------- */

register({
  name: 'OGGI',
  aliases: ['TODAY'],
  signature: 'OGGI()',
  description: 'La data di oggi (YYYY-MM-DD).',
  category: 'Data e ora',
  minArgs: 0,
  fn() {
    return dayjs().format('YYYY-MM-DD');
  },
});

register({
  name: 'ADESSO',
  aliases: ['NOW'],
  signature: 'ADESSO()',
  description: 'Data e ora correnti (YYYY-MM-DD HH:mm:ss).',
  category: 'Data e ora',
  minArgs: 0,
  fn() {
    return dayjs().format('YYYY-MM-DD HH:mm:ss');
  },
});

register({
  name: 'ANNO',
  aliases: ['YEAR'],
  signature: 'ANNO(data)',
  description: 'Anno di una data.',
  category: 'Data e ora',
  fn(args) {
    const d = dayjs(toText(args[0]));
    return d.isValid() ? d.year() : new SpreadsheetError(ERR.VALUE, 'Data non valida');
  },
});

register({
  name: 'MESE',
  aliases: ['MONTH'],
  signature: 'MESE(data)',
  description: 'Mese di una data (1-12).',
  category: 'Data e ora',
  fn(args) {
    const d = dayjs(toText(args[0]));
    return d.isValid() ? d.month() + 1 : new SpreadsheetError(ERR.VALUE, 'Data non valida');
  },
});

register({
  name: 'GIORNO',
  aliases: ['DAY'],
  signature: 'GIORNO(data)',
  description: 'Giorno del mese di una data.',
  category: 'Data e ora',
  fn(args) {
    const d = dayjs(toText(args[0]));
    return d.isValid() ? d.date() : new SpreadsheetError(ERR.VALUE, 'Data non valida');
  },
});

/* --- Informazioni --------------------------------------------------- */

register({
  name: 'RIGA',
  aliases: ['ROW'],
  signature: 'RIGA()',
  description: 'Numero della riga della cella corrente.',
  category: 'Informazioni',
  minArgs: 0,
  fn(_args, ctx) {
    return (ctx.currentCell?.r ?? 0) + 1;
  },
});

register({
  name: 'COLONNA',
  aliases: ['COLUMN'],
  signature: 'COLONNA()',
  description: 'Numero della colonna della cella corrente.',
  category: 'Informazioni',
  minArgs: 0,
  fn(_args, ctx) {
    return (ctx.currentCell?.c ?? 0) + 1;
  },
});

register({
  name: 'INFO',
  aliases: ['INFO'],
  signature: 'INFO(tipo)',
  description: 'Informazioni sull\'ambiente di calcolo (FILES, versione, ecc.).',
  category: 'Informazioni',
  fn(args, ctx) {
    const t = toText(args[0]).toUpperCase();
    if (t === 'VERSIONE' || t === 'VERSION') return 'Mini-Sheet 1.0';
    if (t === 'FILE' || t === 'FILES') return 1;
    if (t === 'RIGHE' || t === 'ROWS') return ctx?.engine?.rows ?? 0;
    if (t === 'COLONNE' || t === 'COLUMNS') return ctx?.engine?.cols ?? 0;
    return 'Mini-Sheet 1.0';
  },
});

/* ------------------------------------------------------------------ */
/* Indici di ricerca                                                  */
/* ------------------------------------------------------------------ */

/** Normalizza un nome di funzione: "conta.valori" -> "CONTAVALORI". */
export function normalizeFunctionName(name) {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[.\s_]/g, '');
}

const BY_NAME = new Map();
const BY_ALIAS = new Map();

for (const def of DEFS) {
  BY_NAME.set(normalizeFunctionName(def.name), def);
  for (const alias of def.aliases) {
    BY_ALIAS.set(normalizeFunctionName(alias), def);
  }
}

/**
 * Cerca la definizione di una funzione.
 * @param {string} name
 * @returns {object|null}
 */
export function resolveFunction(name) {
  const key = normalizeFunctionName(name);
  return BY_NAME.get(key) ?? BY_ALIAS.get(key) ?? null;
}

/** Elenco di tutte le funzioni (per la guida in-app). */
export function listFunctions() {
  return DEFS.slice().sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)
  );
}

export { ERR };
