/**
 * parser.js
 * ---------------------------------------------------------------------------
 * Parser ricorsivo discendente per le formule.
 *
 * Grammatica (precedenza dal piu' basso al piu' alto):
 *
 *   expression  := comparison
 *   comparison  := concat ( ("="|"<>"|"<"|">"|"<="|">=") concat )*
 *   concat      := additive ( "&" additive )*
 *   additive    := multiplicative ( ("+"|"-") multiplicative )*
 *   multiplicative := unary ( ("*"|"/") unary )*
 *   unary       := ("+"|"-") unary | power
 *   power       := postfix ( "^" unary )?            (associativo a destra)
 *   postfix     := primary ( "%" )*
 *   primary     := NUMBER | STRING | BOOL | ERROR
 *                | func "(" args ")"
 *                | range | cell | "(" expression ")"
 *
 * Il parser non conosce il foglio: produce solo un AST. E' l'evaluator
 * (engine.js) a risolvere i riferimenti e a chiamare le funzioni.
 */

import { tokenize, T, FormulaSyntaxError } from './tokenizer.js';
import { lettersToCol, normalizeRect } from './coordinates.js';

export { FormulaSyntaxError };

/** Nodi AST prodotti dal parser. */
export const NodeType = {
  NUMBER: 'number',
  STRING: 'string',
  BOOL: 'bool',
  ERROR: 'error',
  CELL: 'cell',
  RANGE: 'range',
  FUNC: 'func',
  BINOP: 'binop',
  UNARY: 'unary',
  POSTFIX: 'postfix',
};

const TRUE_WORDS = new Set(['VERO', 'TRUE']);
const FALSE_WORDS = new Set(['FALSO', 'FALSE']);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  expect(type, what) {
    const tok = this.next();
    if (tok.type !== type) {
      throw new FormulaSyntaxError(
        `Atteso ${what} ma trovato "${tok.value ?? 'fine formula'}"`,
        tok.start
      );
    }
    return tok;
  }

  // --- livelli della grammatica ------------------------------------------

  parseExpression() {
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseConcat();
    while (this.peek().type === T.OP && ['=', '<>', '<', '>', '<=', '>='].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseConcat();
      left = { type: NodeType.BINOP, op, left, right };
    }
    return left;
  }

  parseConcat() {
    let left = this.parseAdditive();
    while (this.peek().type === T.OP && this.peek().value === '&') {
      this.next();
      const right = this.parseAdditive();
      left = { type: NodeType.BINOP, op: '&', left, right };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek().type === T.OP && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { type: NodeType.BINOP, op, left, right };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.peek().type === T.OP && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { type: NodeType.BINOP, op, left, right };
    }
    return left;
  }

  /** Il segno unario ha precedenza piu' bassa di `^` (come in matematica). */
  parseUnary() {
    const tok = this.peek();
    if (tok.type === T.OP && (tok.value === '+' || tok.value === '-')) {
      this.next();
      const operand = this.parseUnary();
      return { type: NodeType.UNARY, op: tok.value, operand };
    }
    return this.parsePower();
  }

  parsePower() {
    const left = this.parsePostfix();
    if (this.peek().type === T.OP && this.peek().value === '^') {
      this.next();
      const right = this.parseUnary();
      return { type: NodeType.BINOP, op: '^', left, right };
    }
    return left;
  }

  parsePostfix() {
    let node = this.parsePrimary();
    while (this.peek().type === T.OP && this.peek().value === '%') {
      this.next();
      node = { type: NodeType.POSTFIX, op: '%', operand: node };
    }
    return node;
  }

  parsePrimary() {
    const tok = this.peek();

    switch (tok.type) {
      case T.NUMBER:
        this.next();
        return { type: NodeType.NUMBER, value: tok.value };

      case T.STRING:
        this.next();
        return { type: NodeType.STRING, value: tok.value };

      case T.ERROR:
        this.next();
        return { type: NodeType.ERROR, code: tok.value };

      case T.CELL:
        this.next();
        // "A1:B5" -> intervallo
        if (this.peek().type === T.COLON) {
          this.next();
          const end = this.peek();
          if (end.type !== T.CELL) {
            throw new FormulaSyntaxError('Fine intervallo non valida', end.start);
          }
          this.next();
          return {
            type: NodeType.RANGE,
            rect: normalizeRect(tok.value, end.value),
          };
        }
        return { type: NodeType.CELL, r: tok.value.r, c: tok.value.c };

      case T.WORD: {
        const up = String(tok.value).toUpperCase();
        // "A:C" -> intervallo di colonna
        if (this.peek(1).type === T.COLON && /^[A-Za-z]{1,3}$/.test(tok.value)) {
          this.next(); // word
          this.next(); // ':'
          const end = this.peek();
          if (end.type !== T.WORD || !/^[A-Za-z]{1,3}$/.test(end.value)) {
            throw new FormulaSyntaxError('Fine intervallo di colonna non valida', end.start);
          }
          this.next();
          const c1 = lettersToCol(tok.value);
          const c2 = lettersToCol(end.value);
          return {
            type: NodeType.RANGE,
            rect: { r1: 0, c1: Math.min(c1, c2), r2: Infinity, c2: Math.max(c1, c2) },
            wholeColumn: true,
          };
        }
        if (TRUE_WORDS.has(up)) {
          this.next();
          return { type: NodeType.BOOL, value: true };
        }
        if (FALSE_WORDS.has(up)) {
          this.next();
          return { type: NodeType.BOOL, value: false };
        }
        this.next();
        // Identificatore sconosciuto: verra' segnalato come #NOME? in fase di valutazione.
        return { type: NodeType.NAME, name: tok.value };
      }

      case T.FUNC: {
        this.next();
        this.expect(T.LPAREN, '"("');
        const args = [];
        if (this.peek().type !== T.RPAREN) {
          for (;;) {
            args.push(this.parseExpression());
            const sep = this.peek();
            if (sep.type === T.SEMI || sep.type === T.COMMA) {
              this.next();
              // Consenti argomenti vuoti (es. "SE(A1>1;;0)") -> li trattiamo come 0
              if (this.peek().type === T.RPAREN) {
                args.push({ type: NodeType.NUMBER, value: 0 });
                break;
              }
              continue;
            }
            break;
          }
        }
        this.expect(T.RPAREN, '")"');
        return { type: NodeType.FUNC, name: tok.value, args };
      }

      case T.LPAREN: {
        this.next();
        const expr = this.parseExpression();
        this.expect(T.RPAREN, '")"');
        return expr;
      }

      default:
        throw new FormulaSyntaxError(
          `Token inatteso "${tok.value ?? 'fine formula'}"`,
          tok.start
        );
    }
  }
}

/**
 * Parsing completo di una formula.
 * @param {string} source testo con o senza il "=" iniziale
 * @returns {object} AST
 * @throws {FormulaSyntaxError}
 */
export function parseFormula(source) {
  let text = String(source ?? '').trim();
  if (text.startsWith('=')) text = text.slice(1);
  if (text.trim() === '') {
    throw new FormulaSyntaxError('Formula vuota', 0);
  }
  const tokens = tokenize(text);
  const parser = new Parser(tokens);
  const ast = parser.parseExpression();
  const leftover = parser.peek();
  if (leftover.type !== T.EOF) {
    throw new FormulaSyntaxError(
      `Token inatteso "${leftover.value ?? ''}"`,
      leftover.start
    );
  }
  return ast;
}

/**
 * Verifica rapida se una stringa sembra una formula.
 * @param {string} text
 */
export function isFormula(text) {
  return typeof text === 'string' && text.trimStart().startsWith('=');
}
