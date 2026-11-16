/**
 * tokenizer.js
 * ---------------------------------------------------------------------------
 * Lexer delle formule, scritto da zero.
 *
 * Trasforma il testo "=SOMMA(A1:A5)*2" in una sequenza di token. Non conosce
 * la grammatica: si occupa solo di riconoscere i "mattoni" lessicali.
 * La grammatica (precedenza operatori, funzioni, intervalli) e' gestita dal
 * parser ricorsivo discendente in `parser.js`.
 *
 * Tipi di token:
 *   number  42, 3.14, 1e3, .5
 *   string  "testo" (con escape "" per le virgolette interne)
 *   bool    VERO / FALSO (interpretati dal parser)
 *   error   #DIV/0!, #N/A, #VALORE! ...
 *   cell    riferimento cella: A1, $B$7, CV100
 *   word    identificatore non numerico (VERO, NOMEFUNZ, colonna A in "A:C")
 *   func    identificatore immediatamente seguito da "(" -> nome funzione
 *   op      + - * / ^ % & = <> < > <= >=
 *   lparen/rparen/comma/semi/colon
 */

import { parseCellRef } from './coordinates.js';

export const T = {
  NUMBER: 'number',
  STRING: 'string',
  BOOL: 'bool',
  ERROR: 'error',
  CELL: 'cell',
  WORD: 'word',
  FUNC: 'func',
  OP: 'op',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  COMMA: 'comma',
  SEMI: 'semi',
  COLON: 'colon',
  EOF: 'eof',
};

/** Errore di sintassi/lexing: viene convertito in #VALORE! o #NOME? a valle. */
export class FormulaSyntaxError extends Error {
  constructor(message, position = -1) {
    super(message);
    this.name = 'FormulaSyntaxError';
    this.position = position;
  }
}

const OPERATORS = ['<=', '>=', '<>', '=', '<', '>', '+', '-', '*', '/', '^', '&'];

const RE_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const RE_ERROR = /^#[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9]*(?:\/[A-Za-zÀ-ÿ0-9]+)*[!?]?/;
const RE_WORD = /^[A-Za-z_À-ÿ][A-Za-z0-9_.À-ÿ]*/;
/** Riferimento cella: lettere (1-3) + cifre, con $ opzionali. */
const RE_CELLREF = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})(?![A-Za-z0-9_])/;

/**
 * @param {string} source testo della formula (senza il "=" iniziale)
 * @returns {Array<{type:string,value:any,start:number,end:number}>}
 */
export function tokenize(source) {
  const src = String(source ?? '');
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // --- spazi bianchi -----------------------------------------------------
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // --- testo tra virgolette ---------------------------------------------
    if (ch === '"') {
      const start = i;
      let j = i + 1;
      let out = '';
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        out += src[j++];
      }
      if (!closed) {
        throw new FormulaSyntaxError('Stringa di testo non terminata', start);
      }
      tokens.push({ type: T.STRING, value: out, start, end: j + 1 });
      i = j + 1;
      continue;
    }

    // --- errore costante (#DIV/0!, #N/A, ...) ------------------------------
    if (ch === '#') {
      const m = RE_ERROR.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError('Errore non valido', i);
      tokens.push({ type: T.ERROR, value: m[0].toUpperCase(), start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }

    // --- numeri ------------------------------------------------------------
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = RE_NUMBER.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError('Numero non valido', i);
      tokens.push({
        type: T.NUMBER,
        value: parseFloat(m[0]),
        start: i,
        end: i + m[0].length,
      });
      i += m[0].length;
      continue;
    }

    // --- identificatori / riferimenti --------------------------------------
    if (/[A-Za-z_$À-ÿ]/.test(ch)) {
      const rest = src.slice(i);
      const refMatch = RE_CELLREF.exec(rest);
      let token = null;
      let length = 0;

      if (refMatch) {
        const parsed = parseCellRef(refMatch[0]);
        // Un riferimento valido che non continua con un identificatore.
        if (parsed) {
          token = { type: T.CELL, value: parsed };
          length = refMatch[0].length;
        }
      }

      if (!token) {
        const wordMatch = RE_WORD.exec(rest);
        if (!wordMatch) throw new FormulaSyntaxError(`Carattere non valido: "${ch}"`, i);
        token = { type: T.WORD, value: wordMatch[0] };
        length = wordMatch[0].length;
      }

      // Se il token e' immediatamente seguito da "(" e' una chiamata a funzione.
      let k = i + length;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === '(') {
        token.type = T.FUNC;
        token.value = String(token.value).toUpperCase();
      }
      token.start = i;
      token.end = i + length;
      tokens.push(token);
      i += length;
      continue;
    }

    // --- parentesi e separatori --------------------------------------------
    if (ch === '(') {
      tokens.push({ type: T.LPAREN, value: '(', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: T.RPAREN, value: ')', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ';') {
      tokens.push({ type: T.SEMI, value: ';', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: T.COMMA, value: ',', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ':') {
      tokens.push({ type: T.COLON, value: ':', start: i, end: i + 1 });
      i++;
      continue;
    }

    // --- operatori ---------------------------------------------------------
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: T.OP, value: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }

    if (ch === '%') {
      tokens.push({ type: T.OP, value: '%', start: i, end: i + 1 });
      i++;
      continue;
    }

    throw new FormulaSyntaxError(`Carattere non valido: "${ch}"`, i);
  }

  tokens.push({ type: T.EOF, value: null, start: src.length, end: src.length });
  return tokens;
}
