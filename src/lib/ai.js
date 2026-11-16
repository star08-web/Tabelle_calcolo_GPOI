/**
 * ai.js
 * ---------------------------------------------------------------------------
 * Assistente AI *locale*: analisi, spiegazione e generazione di formule.
 *
 * Tutto funziona offline e senza inviare dati a server esterni (vincolo
 * richiesto dalla specifica). Il modulo offre:
 *
 *   - `generateFormula(text, ctx)`  : linguaggio naturale -> formula
 *   - `explainFormula(engine, r, c)` : spiegazione passo-passo di una formula
 *   - `suggestForSelection(...)`    : suggerimenti contestuali
 *   - `analyzeSheet(engine)`        : diagnostica del foglio
 *   - `refactorFormula(raw)`        : proposte di riscrittura
 *
 * Inoltre espone `callOnlineAI(...)`, un connettore *opzionale* verso un
 * endpoint OpenAI-compatible. E' disattivato di default, richiede una chiave
 * fornita esplicitamente dall'utente e non viene mai invocato automaticamente.
 */

import { parseFormula, NodeType } from './parser.js';
import { cellName, colToLetters, parseCellRef } from './coordinates.js';
import { listFunctions, resolveFunction, matchCriteria, parseCriteria } from './functions.js';
import { isError, isBlank, ERR } from './values.js';
import { transformFormulaText, extractReferences } from './formulaTransform.js';

/* ------------------------------------------------------------------ */
/* Utilita' per il linguaggio naturale                                */
/* ------------------------------------------------------------------ */

const RE_RANGE = /\b([A-Za-z]{1,3}\s?\d{1,7})\s*:\s*([A-Za-z]{1,3}\s?\d{1,7})\b/;
const RE_CELL = /\b([A-Za-z]{1,3}\s?\d{1,7})\b/;

/** Estrae un intervallo o una cella dal testo libero. */
function extractRef(text) {
  const range = RE_RANGE.exec(text);
  if (range) {
    const a = parseCellRef(range[1].replace(/\s+/g, ''));
    const b = parseCellRef(range[2].replace(/\s+/g, ''));
    if (a && b) return { kind: 'range', text: `${cellName(a.r, a.c)}:${cellName(b.r, b.c)}` };
  }
  const cell = RE_CELL.exec(text);
  if (cell) {
    const a = parseCellRef(cell[1].replace(/\s+/g, ''));
    if (a) return { kind: 'cell', text: cellName(a.r, a.c) };
  }
  return null;
}

/** Traduce una condizione in italiano ("A1 è maggiore di 5") in sintassi Excel. */
export function translateCondition(text) {
  const raw = String(text ?? '').trim();
  const ref = extractRef(raw);
  if (!ref) return null;
  const rest = raw.replace(RE_RANGE, ' ').replace(RE_CELL, ' ').toLowerCase();

  const ops = [
    [/uguale\s+o\s+maggiore|almeno|maggiore\s+o\s+uguale/, '>='],
    [/uguale\s+o\s+minore|al\s+piu'\s+|al\s+massimo/, '<='],
    [/diverso\s+da|different[ae]\s+da|non\s+uguale/, '<>'],
    [/maggiore\s+di|supera|piu'\s+grande\s+di|oltre/, '>'],
    [/minore\s+di|inferiore\s+a|meno\s+di/, '<'],
    [/uguale\s+a|parecchia\s+a|=,/, '='],
  ];
  let op = '=';
  for (const [re, symbol] of ops) {
    if (re.test(rest)) {
      op = symbol;
      break;
    }
  }
  const num = /(-?\d+(?:[.,]\d+)?)/.exec(rest);
  const value = num ? num[1].replace(',', '.') : '';
  return `${ref.text}${op}${value}`;
}

/**
 * Genera una formula a partire da una richiesta in linguaggio naturale.
 * @param {string} text
 * @returns {{formula:string|null, explanation:string, intent:string}}
 */
export function generateFormula(text) {
  const input = String(text ?? '').trim();
  if (!input) {
    return { formula: null, explanation: 'Scrivi una richiesta (es. "somma A1:A10").', intent: 'vuoto' };
  }
  const lower = input.toLowerCase();
  const ref = extractRef(input);

  // --- SE(condizione; vero; falso) ---------------------------------------
  const seMatch = /\bse\b\s+(.+?)\s+allora\s+(.+?)(?:\s+altrimenti\s+(.+))?$/i.exec(input);
  if (seMatch) {
    const cond = translateCondition(seMatch[1]);
    if (cond) {
      const vero = seMatch[2].trim();
      const falso = (seMatch[3] ?? '0').trim();
      return {
        formula: `=SE(${cond};${vero};${falso})`,
        explanation: `Ho interpretato la condizione "${seMatch[1].trim()}" come ${cond}.`,
        intent: 'condizionale',
      };
    }
  }

  // --- criterio condizionale (maggiori di N, minori di N, ...) ------------
  const crit = extractCriterion(lower);
  if (ref && crit) {
    const map = {
      somma: 'SOMMA.SE',
      conta: 'CONTA.SE',
      media: 'MEDIA.SE',
    };
    const fn = map[crit.kind];
    if (fn) {
      return {
        formula: `=${fn}(${ref.text};"${crit.op}${crit.value}")`,
        explanation: `Ho applicato il filtro "${crit.op}${crit.value}" all'intervallo ${ref.text}.`,
        intent: 'condizionale-aggregato',
      };
    }
  }

  if (!ref) {
    return {
      formula: null,
      explanation:
        'Non sono riuscito a trovare un riferimento di cella (es. A1 o A1:B10) nella richiesta.',
      intent: 'non-riconosciuto',
    };
  }

  // --- aggregazioni semplici ---------------------------------------------
  const aggregations = [
    { keys: ['somma', 'sommato', 'sommale', 'totale', 'addiziona'], fn: 'SOMMA', label: 'la somma' },
    { keys: ['media', 'media aritmetica', 'valor medio'], fn: 'MEDIA', label: 'la media' },
    { keys: ['conta quante', 'conta i numeri', 'conta le celle numeriche', 'quanti numeri'], fn: 'CONTA', label: 'il conteggio delle celle numeriche' },
    { keys: ['conta le celle non vuote', 'conta valori', 'quante celle non vuote'], fn: 'CONTA.VALORI', label: 'il conteggio delle celle non vuote' },
    { keys: ['massimo', 'il max', 'valore massimo'], fn: 'MAX', label: 'il valore massimo' },
    { keys: ['minimo', 'il min', 'valore minimo'], fn: 'MIN', label: 'il valore minimo' },
  ];
  for (const agg of aggregations) {
    if (agg.keys.some((k) => lower.includes(k))) {
      return {
        formula: `=${agg.fn}(${ref.text})`,
        explanation: `Ho interpretato la richiesta come ${agg.label} di ${ref.text}.`,
        intent: 'aggregazione',
      };
    }
  }

  // --- funzioni su singola cella -----------------------------------------
  const singleFunctions = [
    { keys: ['radice quadrata', 'radice'], fn: 'RADQ', args: (ref) => [ref] },
    { keys: ['arrotonda', 'arrotondato'], fn: 'ARROTONDA', args: (ref) => [ref, extractDigits(lower)] },
    { keys: ['assoluto', 'valore assoluto'], fn: 'ASSOLUTO', args: (ref) => [ref] },
    { keys: ['concatena', 'unisci'], fn: 'CONCAT', args: (ref) => [ref] },
    { keys: ['potenza', 'elevato a'], fn: 'POTENZA', args: (ref) => [ref, extractNumber(lower) ?? '2'] },
  ];
  for (const sf of singleFunctions) {
    if (sf.keys.some((k) => lower.includes(k))) {
      const args = sf.args(ref.text).filter((a) => a !== null && a !== undefined && a !== '');
      return {
        formula: `=${sf.fn}(${args.join(';')})`,
        explanation: `Ho interpretato la richiesta come ${sf.fn} applicato a ${ref.text}.`,
        intent: 'funzione-singola',
      };
    }
  }

  return {
    formula: null,
    explanation: `Non riconosco l'intento. Riferimento trovato: ${ref.text}.`,
    intent: 'non-riconosciuto',
  };
}

/** Estrae un criterio tipo ">5" dal testo. */
function extractCriterion(lower) {
  const patterns = [
    [/maggiori\s+di\s+(-?\d+(?:[.,]\d+)?)/, '>'],
    [/maggiori\s+di\s+(-?\d+(?:[.,]\d+)?)/, '>'],
    [/superiori\s+a\s+(-?\d+(?:[.,]\d+)?)/, '>'],
    [/oltre\s+(-?\d+(?:[.,]\d+)?)/, '>'],
    [/minori\s+di\s+(-?\d+(?:[.,]\d+)?)/, '<'],
    [/inferiori\s+a\s+(-?\d+(?:[.,]\d+)?)/, '<'],
    [/uguali\s+a\s+(-?\d+(?:[.,]\d+)?)/, '='],
    [/diversi\s+da\s+(-?\d+(?:[.,]\d+)?)/, '<>'],
  ];
  for (const [re, op] of patterns) {
    const m = re.exec(lower);
    if (m) return { op, value: m[1].replace(',', '.'), kind: detectKind(lower) };
  }
  return null;
}

/** Individua a quale aggregazione condizionale si riferisce il testo. */
function detectKind(lower) {
  if (lower.includes('somma')) return 'somma';
  if (lower.includes('conta') || lower.includes('quanti')) return 'conta';
  if (lower.includes('media')) return 'media';
  return null;
}

/** Estrae un numero dalla frase. */
function extractNumber(lower) {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(lower);
  return m ? m[1].replace(',', '.') : null;
}

/** Estrae il numero di decimali richiesto ("a 2 decimali"). */
function extractDigits(lower) {
  const m = /(\d+)\s*decimal/i.exec(lower);
  return m ? m[1] : '0';
}

/* ------------------------------------------------------------------ */
/* Spiegazione di una formula                                          */
/* ------------------------------------------------------------------ */

/**
 * Spiega la formula di una cella.
 * @param {import('./engine.js').SheetEngine} engine
 * @param {number} r
 * @param {number} c
 */
export function explainFormula(engine, r, c) {
  const raw = engine.getRaw(r, c);
  const address = cellName(r, c);
  if (!raw.trim().startsWith('=')) {
    return {
      ok: false,
      address,
      formula: raw,
      message: 'La cella selezionata non contiene una formula.',
    };
  }
  let ast;
  try {
    ast = parseFormula(raw);
  } catch (e) {
    return {
      ok: false,
      address,
      formula: raw,
      message: `Errore di sintassi: ${e.message}`,
    };
  }

  const steps = [];
  const text = describeNode(ast, engine, steps);
  const result = engine.getValue(r, c);
  const error = isError(result) ? result : null;

  return {
    ok: true,
    address,
    formula: raw,
    result: engine.getDisplay(r, c),
    error: error ? { code: error.code, detail: error.detail } : null,
    steps,
    text,
  };
}

const OP_WORDS = {
  '+': 'sommato a',
  '-': 'sottraendo',
  '*': 'moltiplicato per',
  '/': 'diviso per',
  '^': 'elevato alla potenza di',
  '&': 'concatenato con',
  '=': 'uguale a',
  '<>': 'diverso da',
  '<': 'minore di',
  '>': 'maggiore di',
  '<=': 'minore o uguale a',
  '>=': 'maggiore o uguale a',
};

/** Descrive un nodo dell'AST in linguaggio naturale. */
function describeNode(node, engine, steps) {
  if (!node) return '';
  let label = '';
  switch (node.type) {
    case NodeType.NUMBER:
      label = `il numero ${node.value}`;
      break;
    case NodeType.STRING:
      label = `il testo "${node.value}"`;
      break;
    case NodeType.BOOL:
      label = node.value ? 'VERO' : 'FALSO';
      break;
    case NodeType.ERROR:
      label = `l'errore ${node.code}`;
      break;
    case NodeType.CELL: {
      const value = engine.getValue(node.r, node.c);
      const shown = engine.getDisplay(node.r, node.c);
      label = `la cella ${cellName(node.r, node.c)} (${isBlank(value) ? 'vuota' : shown})`;
      break;
    }
    case NodeType.RANGE: {
      const rect = node.rect;
      const count = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
      label = `l'intervallo ${cellName(rect.r1, rect.c1)}:${cellName(rect.r2, rect.c2)} (${count} celle)`;
      break;
    }
    case NodeType.BINOP: {
      const l = describeNode(node.left, engine, steps);
      const r = describeNode(node.right, engine, steps);
      label = `${l} ${OP_WORDS[node.op] ?? node.op} ${r}`;
      break;
    }
    case NodeType.UNARY:
      label = `${node.op === '-' ? 'il opposto di ' : ''}${describeNode(node.operand, engine, steps)}`;
      break;
    case NodeType.POSTFIX:
      label = `${describeNode(node.operand, engine, steps)} per cento`;
      break;
    case NodeType.FUNC: {
      const def = resolveFunction(node.name);
      const args = node.args.map((a) => describeNode(a, engine, steps));
      label = `la funzione ${def ? def.name : node.name}(${args.join('; ')})`;
      break;
    }
    default:
      label = 'un valore';
  }
  steps.push({ type: node.type, text: label });
  return label;
}

/* ------------------------------------------------------------------ */
/* Suggerimenti e diagnostica                                          */
/* ------------------------------------------------------------------ */

/**
 * Suggerisce delle formule per la cella selezionata.
 * @param {import('./engine.js').SheetEngine} engine
 * @param {number} r
 * @param {number} c
 */
export function suggestForSelection(engine, r, c) {
  const out = [];
  const above = engine.getRaw(r - 1, c);
  const left = engine.getRaw(r, c - 1);

  // Propagamento da una formula simile (comportamento "riempimento")
  if (above.trim().startsWith('=')) {
    out.push({
      formula: transformFormulaText(above, { rowFrom: r - 1, rowDelta: 1 }),
      reason: 'La cella sopra contiene una formula: puoi replicarla.',
    });
  }
  if (left.trim().startsWith('=')) {
    out.push({
      formula: transformFormulaText(left, { colFrom: c - 1, colDelta: 1 }),
      reason: 'La cella a sinistra contiene una formula: puoi replicarla.',
    });
  }

  // Aggregazioni sul blocco di numeri sopra/sinistra
  const block = findNumericBlock(engine, r, c);
  if (block) {
    out.push({ formula: `=SOMMA(${block})`, reason: 'Somma del blocco di valori vicino.' });
    out.push({ formula: `=MEDIA(${block})`, reason: 'Media del blocco di valori vicino.' });
    out.push({ formula: `=MAX(${block})`, reason: 'Massimo del blocco di valori vicino.' });
    out.push({ formula: `=MIN(${block})`, reason: 'Minimo del blocco di valori vicino.' });
  }
  return out;
}

/** Cerca un blocco contiguo di numeri sopra o a sinistra della cella. */
function findNumericBlock(engine, r, c) {
  let top = r - 1;
  while (top >= 0 && isNumericCell(engine, top, c)) top--;
  if (top < r - 1) {
    return `${cellName(top + 1, c)}:${cellName(r - 1, c)}`;
  }
  let left = c - 1;
  while (left >= 0 && isNumericCell(engine, r, left)) left--;
  if (left < c - 1) {
    return `${cellName(r, left + 1)}:${cellName(r, c - 1)}`;
  }
  return null;
}

function isNumericCell(engine, r, c) {
  if (r < 0 || c < 0) return false;
  const v = engine.getValue(r, c);
  return typeof v === 'number';
}

/**
 * Diagnostica del foglio: errori, circoli, funzioni usate.
 * @param {import('./engine.js').SheetEngine} engine
 */
export function analyzeSheet(engine) {
  const errors = [];
  const circular = [];
  const usedFunctions = new Map();
  let formulaCount = 0;
  let filledCells = 0;

  for (const [key, cell] of engine.cells) {
    if (cell.raw === '') continue;
    filledCells++;
    if (cell.ast) {
      formulaCount++;
      for (const node of collectFuncNodes(cell.ast)) {
        usedFunctions.set(node.name, (usedFunctions.get(node.name) ?? 0) + 1);
      }
    }
    const value = cell.value;
    if (isError(value)) {
      const r = Math.floor(key / 1000);
      const c = key % 1000;
      const entry = {
        address: cellName(r, c),
        code: value.code,
        detail: value.detail,
        formula: cell.raw,
      };
      if (value.circular) circular.push(entry);
      else errors.push(entry);
    }
  }

  return {
    filledCells,
    formulaCount,
    errors,
    circular,
    functions: [...usedFunctions.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Raccoglie i nodi FUNZ presenti in un AST. */
function collectFuncNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === NodeType.FUNC) out.push(node);
  if (node.type === NodeType.BINOP) {
    collectFuncNodes(node.left, out);
    collectFuncNodes(node.right, out);
  }
  if (node.type === NodeType.UNARY || node.type === NodeType.POSTFIX) {
    collectFuncNodes(node.operand, out);
  }
  if (node.type === NodeType.FUNC) {
    for (const a of node.args) collectFuncNodes(a, out);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Refactoring assistito                                               */
/* ------------------------------------------------------------------ */

/**
 * Propone una riscrittura "piu' pulita" di una formula.
 * @param {string} raw
 * @returns {Array<{formula:string, reason:string}>}
 */
export function refactorFormula(raw) {
  const out = [];
  const text = String(raw ?? '').trim();
  if (!text.startsWith('=')) return out;

  // "=A1+A2+A3" -> "=SOMMA(A1:A3)"
  const sumMatch = /^=([A-Za-z]{1,3}\d{1,7}(?:\s*\+\s*[A-Za-z]{1,3}\d{1,7}){2,})$/.exec(text);
  if (sumMatch) {
    const parts = sumMatch[1].split('+').map((p) => p.trim());
    const parsed = parts.map((p) => parseCellRef(p));
    if (parsed.every(Boolean)) {
      const sameCol = parsed.every((p) => p.c === parsed[0].c);
      const sameRow = parsed.every((p) => p.r === parsed[0].r);
      const contiguous = sameCol
        ? parsed.every((p, i) => i === 0 || p.r === parsed[i - 1].r + 1)
        : sameRow
          ? parsed.every((p, i) => i === 0 || p.c === parsed[i - 1].c + 1)
          : false;
      if (contiguous) {
        const first = parsed[0];
        const last = parsed[parsed.length - 1];
        const range = `${cellName(first.r, first.c)}:${cellName(last.r, last.c)}`;
        out.push({
          formula: `=SOMMA(${range})`,
          reason: 'Una somma ripetuta puo\' essere scritta con la funzione SOMMA su intervallo.',
        });
      }
    }
  }

  // Riferimenti inutili: "=A1*1", "=A1+0"
  const mulOne = /^=([A-Za-z]{1,3}\d{1,7})\s*\*\s*1$/.exec(text);
  if (mulOne) {
    out.push({ formula: `=${mulOne[1]}`, reason: 'Moltiplicare per 1 non cambia il risultato.' });
  }
  const plusZero = /^=([A-Za-z]{1,3}\d{1,7})\s*\+\s*0$/.exec(text);
  if (plusZero) {
    out.push({ formula: `=${plusZero[1]}`, reason: 'Sommare zero non cambia il risultato.' });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Connettore online opzionale                                        */
/* ------------------------------------------------------------------ */

/**
 * Chiamata a un endpoint OpenAI-compatible. Viene invocata SOLO su
 * richiesta esplicita dell'utente e solo dopo che l'utente ha inserito la
 * propria chiave: nessun dato del foglio viene inviato automaticamente.
 *
 * @param {{endpoint:string, apiKey:string, model:string, prompt:string, context?:string}} options
 * @returns {Promise<{ok:boolean, text?:string, error?:string}>}
 */
export async function callOnlineAI({ endpoint, apiKey, model, prompt, context = '' }) {
  if (!endpoint || !apiKey) {
    return { ok: false, error: 'Endpoint e chiave API sono obbligatori.' };
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Sei un assistente per fogli di calcolo. Rispondi in italiano, in modo breve e preciso. ' +
              'Le funzioni disponibili sono: SOMMA, MEDIA, CONTA, CONTA.VALORI, SOMMA.SE, CONTA.SE, MEDIA.SE, ' +
              'MAX, MIN, SE, CONCAT, ARROTONDA, RADQ, POTENZA, ASSOLUTO e altre. ' +
              'Gli argomenti sono separati dal punto e virgola.',
          },
          {
            role: 'user',
            content: context ? `${context}\n\n${prompt}` : prompt,
          },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `Errore ${response.status}: ${body.slice(0, 200)}` };
    }
    const data = await response.json();
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.content?.[0]?.text ??
      data?.output_text ??
      '';
    return { ok: true, text: String(text) };
  } catch (e) {
    return { ok: false, error: `Impossibile contattare il servizio: ${e.message}` };
  }
}

export { listFunctions, extractReferences, matchCriteria, parseCriteria, ERR };
