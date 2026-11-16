/**
 * formulaTransform.js
 * ---------------------------------------------------------------------------
 * Trasformazione testuale delle formule quando la griglia viene modificata
 * (inserimento o eliminazione di righe/colonne).
 *
 * Esempio: se viene inserita una riga in posizione 3, "=A1+B3" diventa
 * "=A1+B4" e "=SOMMA(A1:A5)" diventa "=SOMMA(A1:A6)".
 *
 * Il testo viene tokenizzato, i riferimenti vengono spostati e la formula
 * viene ricostruita: in questo modo le stringhe tra virgolette non vengono
 * mai toccate e la struttura della formula resta valida.
 */

import { tokenize, T, FormulaSyntaxError } from './tokenizer.js';
import { colToLetters, cellName, parseCellRef } from './coordinates.js';

/**
 * Applica uno spostamento ai riferimenti di una formula.
 *
 * @param {string} raw testo della formula (con o senza "=")
 * @param {{rowFrom?:number, rowDelta?:number, colFrom?:number, colDelta?:number}} shift
 * @returns {string} la formula trasformata (stringa identica se non valida)
 */
export function transformFormulaText(raw, shift) {
  const text = String(raw ?? '');
  if (!text.trim().startsWith('=')) return text;

  const { rowFrom = Infinity, rowDelta = 0, colFrom = Infinity, colDelta = 0 } = shift;

  let tokens;
  try {
    tokens = tokenize(text.slice(1));
  } catch {
    return text; // formula non tokenizzabile: lasciala com'e'
  }

  const out = [];
  for (const token of tokens) {
    if (token.type === T.EOF) break;
    switch (token.type) {
      case T.CELL: {
        const moved = moveRef(token.value, rowFrom, rowDelta, colFrom, colDelta);
        if (moved === null) {
          // Riferimento annullato (riga/colonna eliminata) -> #RIF!
          out.push('#RIF!');
        } else {
          out.push(formatRef(moved));
        }
        break;
      }
      case T.NUMBER:
        out.push(String(token.value));
        break;
      case T.STRING:
        out.push('"' + String(token.value).replace(/"/g, '""') + '"');
        break;
      case T.ERROR:
        out.push(String(token.value));
        break;
      case T.FUNC:
        // La "(" viene aggiunta dal token LPAREN successivo.
        out.push(String(token.value));
        break;
      case T.WORD:
        out.push(String(token.value));
        break;
      case T.OP:
        out.push(String(token.value));
        break;
      case T.LPAREN:
        out.push('(');
        break;
      case T.RPAREN:
        out.push(')');
        break;
      case T.COLON:
        out.push(':');
        break;
      case T.COMMA:
      case T.SEMI:
        out.push(';');
        break;
      default:
        break;
    }
  }
  return '=' + out.join('');
}

/**
 * Sposta un singolo riferimento.
 * @returns {{r:number,c:number,absRow:boolean,absCol:boolean}|null}
 */
function moveRef(ref, rowFrom, rowDelta, colFrom, colDelta) {
  let r = ref.r;
  let c = ref.c;

  if (rowDelta > 0) {
    if (r >= rowFrom) r += rowDelta;
  } else if (rowDelta < 0) {
    if (r >= rowFrom) r += rowDelta;
    else if (r >= rowFrom + rowDelta) return null; // cella eliminata
  }

  if (colDelta > 0) {
    if (c >= colFrom) c += colDelta;
  } else if (colDelta < 0) {
    if (c >= colFrom) c += colDelta;
    else if (c >= colFrom + colDelta) return null; // colonna eliminata
  }

  return { r, c, absRow: ref.absRow, absCol: ref.absCol };
}

/** Ricostruisce il testo di un riferimento, preservando i "$". */
function formatRef(ref) {
  const col = (ref.absCol ? '$' : '') + colToLetters(ref.c);
  const row = (ref.absRow ? '$' : '') + (ref.r + 1);
  return col + row;
}

/**
 * Elenco dei riferimenti (celle e intervalli) presenti in una formula.
 * Utile per analisi e per il pannello "dipendenze".
 * @param {string} raw
 * @returns {Array<{r:number,c:number}|{r1:number,c1:number,r2:number,c2:number}>}
 */
export function extractReferences(raw) {
  const text = String(raw ?? '');
  if (!text.trim().startsWith('=')) return [];
  let tokens;
  try {
    tokens = tokenize(text.slice(1));
  } catch {
    return [];
  }
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== T.CELL) continue;
    const next = tokens[i + 1];
    if (next && next.type === T.COLON && tokens[i + 2] && tokens[i + 2].type === T.CELL) {
      const a = token.value;
      const b = tokens[i + 2].value;
      out.push({
        r1: Math.min(a.r, b.r),
        c1: Math.min(a.c, b.c),
        r2: Math.max(a.r, b.r),
        c2: Math.max(a.c, b.c),
      });
      i += 2;
    } else {
      out.push({ r: token.value.r, c: token.value.c });
    }
  }
  return out;
}

export { FormulaSyntaxError, parseCellRef, cellName };
