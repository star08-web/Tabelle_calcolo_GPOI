import { describe, it, expect } from 'vitest';
import { SheetEngine } from '../src/lib/engine.js';
import {
  parseCellRef,
  colToLetters,
  lettersToCol,
  cellName,
  parseRangeText,
  MAX_COLS,
} from '../src/lib/coordinates.js';
import { parseFormula, NodeType } from '../src/lib/parser.js';
import { tokenize, T } from '../src/lib/tokenizer.js';
import { transformFormulaText, extractReferences } from '../src/lib/formulaTransform.js';
import { generateFormula, translateCondition, refactorFormula } from '../src/lib/ai.js';
import { sheetToCsv, parseCsv } from '../src/lib/storage.js';
import { listFunctions, resolveFunction } from '../src/lib/functions.js';

describe('coordinate', () => {
  it('converte colonne in lettere e viceversa', () => {
    expect(colToLetters(0)).toBe('A');
    expect(colToLetters(25)).toBe('Z');
    expect(colToLetters(26)).toBe('AA');
    expect(colToLetters(99)).toBe('CV');
    expect(lettersToCol('CV')).toBe(99);
    expect(lettersToCol('a')).toBe(0);
  });

  it('la griglia copre A1:CV100', () => {
    expect(cellName(0, 0)).toBe('A1');
    expect(cellName(99, 99)).toBe('CV100');
    expect(MAX_COLS).toBe(100);
  });

  it('parsing dei riferimenti', () => {
    expect(parseCellRef('A1')).toMatchObject({ r: 0, c: 0 });
    expect(parseCellRef('$B$7')).toMatchObject({ r: 6, c: 1, absRow: true, absCol: true });
    expect(parseCellRef('XYZ')).toBeNull();
    expect(parseRangeText('A1:B5')).toMatchObject({ r1: 0, c1: 0, r2: 4, c2: 1 });
  });
});

describe('tokenizer', () => {
  it('riconosce i token principali', () => {
    const tokens = tokenize('SOMMA(A1:A5)+2*"x"');
    expect(tokens[0].type).toBe(T.FUNC);
    expect(tokens[0].value).toBe('SOMMA');
    expect(tokens[1].type).toBe(T.LPAREN);
    expect(tokens[2].type).toBe(T.CELL);
    expect(tokens[3].type).toBe(T.COLON);
    expect(tokens[4].type).toBe(T.CELL);
    expect(tokens[5].type).toBe(T.RPAREN);
    expect(tokens[6].type).toBe(T.OP);
    expect(tokens[7].type).toBe(T.NUMBER);
    expect(tokens[9].type).toBe(T.STRING);
  });

  it('riconosce le costanti di errore', () => {
    const tokens = tokenize('#DIV/0!');
    expect(tokens[0].type).toBe(T.ERROR);
    expect(tokens[0].value).toBe('#DIV/0!');
  });

  it('rifiuta una stringa non terminata', () => {
    expect(() => tokenize('"abc')).toThrow();
  });
});

describe('parser', () => {
  it('costruisce un AST per le formule attese', () => {
    const ast = parseFormula('=A1+B2*2');
    expect(ast.type).toBe(NodeType.BINOP);
    expect(ast.op).toBe('+');
    expect(ast.right.type).toBe(NodeType.BINOP);
    expect(ast.right.op).toBe('*');
  });

  it('riconosce gli intervalli', () => {
    const ast = parseFormula('=SOMMA(A1:CV100)');
    expect(ast.type).toBe(NodeType.FUNC);
    expect(ast.args[0].type).toBe(NodeType.RANGE);
    expect(ast.args[0].rect).toMatchObject({ r1: 0, c1: 0, r2: 99, c2: 99 });
  });

  it('segnala gli errori di sintassi', () => {
    expect(() => parseFormula('=A1+')).toThrow();
    expect(() => parseFormula('=(A1')).toThrow();
  });
});

describe('trasformazione delle formule', () => {
  it('sposta i riferimenti dopo l\'inserimento di una riga', () => {
    expect(transformFormulaText('=SOMMA(A1:A2)', { rowFrom: 0, rowDelta: 1 })).toBe('=SOMMA(A2:A3)');
    expect(transformFormulaText('=B3+1', { rowFrom: 2, rowDelta: 1 })).toBe('=B4+1');
  });

  it('non tocca le stringhe', () => {
    expect(transformFormulaText('=CONCAT("A1:B5")', { rowFrom: 0, rowDelta: 1 })).toBe(
      '=CONCAT("A1:B5")'
    );
  });

  it('estrae i riferimenti', () => {
    const refs = extractReferences('=SOMMA(A1:B2)+C3');
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(refs[1]).toMatchObject({ r: 2, c: 2 });
  });
});

describe('assistente AI (offline)', () => {
  it('genera formule dal linguaggio naturale', () => {
    expect(generateFormula('somma A1:A10').formula).toBe('=SOMMA(A1:A10)');
    expect(generateFormula('media di B2:B20').formula).toBe('=MEDIA(B2:B20)');
    expect(generateFormula('conta i valori maggiori di 5 in A1:A10').formula).toBe(
      '=CONTA.SE(A1:A10;">5")'
    );
    expect(generateFormula('se A1 è maggiore di 10 allora 1 altrimenti 0').formula).toBe(
      '=SE(A1>10;1;0)'
    );
  });

  it('traduce le condizioni', () => {
    expect(translateCondition('B2 è minore di 4')).toBe('B2<4');
    expect(translateCondition('C3 è uguale a 7')).toBe('C3=7');
  });

  it('propone refactoring', () => {
    const proposals = refactorFormula('=A1+A2+A3');
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].formula).toBe('=SOMMA(A1:A3)');
  });
});

describe('CSV', () => {
  it('esporta e reimporta', () => {
    const engine = new SheetEngine();
    engine.setRaw(0, 0, 'Testo');
    engine.setRaw(0, 1, '42');
    engine.setRaw(1, 0, '=B1*2');
    const csv = sheetToCsv(engine);
    expect(csv.split('\r\n')[0]).toBe('Testo;42');

    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['Testo', '42']);
    // la formula =B1*2 (in A2) viene esportata con il suo valore
    expect(rows[1][0]).toBe('84');
  });

  it('gestisce i campi con virgolette', () => {
    const rows = parseCsv('a;"b;c";d');
    expect(rows[0]).toEqual(['a', 'b;c', 'd']);
  });
});

describe('registro funzioni', () => {
  it('espone le funzioni richieste dalla traccia', () => {
    for (const name of [
      'SOMMA',
      'MEDIA',
      'CONTA',
      'CONTA.VALORI',
      'SOMMA.SE',
      'CONTA.SE',
      'MEDIA.SE',
      'MAX',
      'MIN',
    ]) {
      expect(resolveFunction(name)).not.toBeNull();
    }
  });

  it('supporta gli alias inglesi', () => {
    expect(resolveFunction('SUM')?.name).toBe('SOMMA');
    expect(resolveFunction('countif')?.name).toBe('CONTA.SE');
  });

  it('espone almeno 40 funzioni', () => {
    expect(listFunctions().length).toBeGreaterThanOrEqual(40);
  });
});
