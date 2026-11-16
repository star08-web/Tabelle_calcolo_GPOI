import { describe, it, expect } from 'vitest';
import { SheetEngine } from '../src/lib/engine.js';

const E = () => new SheetEngine({ rows: 100, cols: 100 });

describe('motore di calcolo - casi di test obbligatori', () => {
  it('1. A1=5, A2=10, A3==SOMMA(A1:A2) -> 15', () => {
    const e = E();
    e.setRaw(0, 0, '5');
    e.setRaw(1, 0, '10');
    e.setRaw(2, 0, '=SOMMA(A1:A2)');
    expect(e.getValue(2, 0)).toBe(15);
    expect(e.getDisplay(2, 0)).toBe('15');
  });

  it('2. B1=0, B2==A1/B1 -> #DIV/0!', () => {
    const e = E();
    e.setRaw(0, 0, '42');
    e.setRaw(0, 1, '0');
    e.setRaw(1, 1, '=A1/B1');
    expect(e.getDisplay(1, 1)).toBe('#DIV/0!');
    expect(e.getError(1, 1).code).toBe('#DIV/0!');
  });

  it('3. C1==C1 -> errore di riferimento circolare', () => {
    const e = E();
    e.setRaw(0, 2, '=C1');
    expect(e.getDisplay(0, 2)).toBe('#RIF!');
    expect(e.getError(0, 2).circular).toBe(true);
  });

  it('3b. ciclo a due celle A1 -> B1 -> A1', () => {
    const e = E();
    e.setRaw(0, 0, '=B1');
    e.setRaw(0, 1, '=A1');
    expect(e.getDisplay(0, 0)).toBe('#RIF!');
    expect(e.getDisplay(0, 1)).toBe('#RIF!');
  });

  it('4. D1==CONTA.SE(A1:A10;">5") con valori misti', () => {
    const e = E();
    const valori = [10, 3, 7, 5, 20, 'testo', 6, 1, 9, 11];
    valori.forEach((v, i) => e.setRaw(i, 0, String(v)));
    e.setRaw(0, 3, '=CONTA.SE(A1:A10;">5")');
    // numeri > 5: 10,7,20,6,9,11 -> 6
    expect(e.getValue(0, 3)).toBe(6);
  });

  it('5. E1==SOMMA(A1:CV100) su griglia vuota -> 0 senza crash', () => {
    const e = E();
    e.setRaw(0, 4, '=SOMMA(A1:CV100)');
    expect(e.getValue(0, 4)).toBe(0);
  });
});

describe('operatori e precedenza', () => {
  it('precedenza matematica', () => {
    const e = E();
    e.setRaw(0, 0, '=1+2*3');
    expect(e.getValue(0, 0)).toBe(7);
    e.setRaw(1, 0, '=(1+2)*3');
    expect(e.getValue(1, 0)).toBe(9);
    e.setRaw(2, 0, '=-2^2');
    expect(e.getValue(2, 0)).toBe(-4);
    e.setRaw(3, 0, '=2^3^2');
    expect(e.getValue(3, 0)).toBe(512);
    e.setRaw(4, 0, '=10%');
    expect(e.getValue(4, 0)).toBeCloseTo(0.1, 10);
  });

  it('riferimenti a celle e stringhe', () => {
    const e = E();
    e.setRaw(0, 0, 'Ciao come va');
    e.setRaw(1, 0, '=A1');
    expect(e.getValue(1, 0)).toBe('Ciao come va');
  });
});

describe('funzioni', () => {
  it('SOMMA / MEDIA / CONTA / CONTA.VALORI', () => {
    const e = E();
    [1, 2, 3, 4, 5].forEach((v, i) => e.setRaw(i, 0, String(v)));
    e.setRaw(0, 1, '=SOMMA(A1:A5)');
    e.setRaw(1, 1, '=MEDIA(A1:A5)');
    e.setRaw(2, 1, '=CONTA(A1:A5)');
    e.setRaw(3, 1, '=CONTA.VALORI(A1:A5)');
    e.setRaw(0, 2, '=MAX(A1:A5)');
    e.setRaw(1, 2, '=MIN(A1:A5)');
    expect(e.getValue(0, 1)).toBe(15);
    expect(e.getValue(1, 1)).toBe(3);
    expect(e.getValue(2, 1)).toBe(5);
    expect(e.getValue(3, 1)).toBe(5);
    expect(e.getValue(0, 2)).toBe(5);
    expect(e.getValue(1, 2)).toBe(1);
  });

  it('SOMMA.SE / MEDIA.SE / CONTA.SE', () => {
    const e = E();
    [10, 3, 7, 5, 20].forEach((v, i) => e.setRaw(i, 0, String(v)));
    e.setRaw(0, 1, '=SOMMA.SE(A1:A5;">5")');
    e.setRaw(1, 1, '=CONTA.SE(A1:A5;">5")');
    e.setRaw(2, 1, '=MEDIA.SE(A1:A5;">5")');
    expect(e.getValue(0, 1)).toBe(37);
    expect(e.getValue(1, 1)).toBe(3);
    expect(e.getValue(2, 1)).toBeCloseTo(37 / 3, 10);
  });

  it('funzione sconosciuta -> #NOME?', () => {
    const e = E();
    e.setRaw(0, 0, '=PIPPO(1)');
    expect(e.getDisplay(0, 0)).toBe('#NOME?');
  });

  it('testo non numerico in operazione -> #VALORE!', () => {
    const e = E();
    e.setRaw(0, 0, 'abc');
    e.setRaw(1, 0, '=A1+1');
    expect(e.getDisplay(1, 0)).toBe('#VALORE!');
  });
});

describe('ricalcolo incrementale e dipendenze', () => {
  it('ricalcola le dipendenti', () => {
    const e = E();
    e.setRaw(0, 0, '1');
    e.setRaw(1, 0, '=A1*10');
    e.setRaw(2, 0, '=A2+5');
    expect(e.getValue(2, 0)).toBe(15);
    e.setRaw(0, 0, '2');
    expect(e.getValue(1, 0)).toBe(20);
    expect(e.getValue(2, 0)).toBe(25);
  });

  it('100 dipendenze si aggiornano correttamente', () => {
    const e = E();
    e.setRaw(0, 0, '1');
    for (let i = 0; i < 100; i++) {
      e.setRaw(i + 1, 1, `=A1*${i}`);
    }
    e.setRaw(0, 0, '3');
    for (let i = 0; i < 100; i++) {
      expect(e.getValue(i + 1, 1)).toBe(3 * i);
    }
  });

  it('intervalli ampi', () => {
    const e = E();
    e.setRaw(0, 0, '=SOMMA(A1:CV100)');
    expect(e.getValue(0, 0)).toBe(0);
    e.setRaw(50, 50, '7');
    expect(e.getValue(0, 0)).toBe(7);
  });
});

describe('inserimento / eliminazione righe e colonne', () => {
  it('sposta i riferimenti', () => {
    const e = E();
    e.setRaw(0, 0, '1');
    e.setRaw(1, 0, '2');
    e.setRaw(2, 0, '=SOMMA(A1:A2)');
    e.insertRows(0, 1);
    expect(e.getRaw(3, 0)).toBe('=SOMMA(A2:A3)');
    expect(e.getValue(3, 0)).toBe(3);
  });

  it('eliminazione riga -> riferimento a #RIF!', () => {
    const e = E();
    e.setRaw(0, 0, '1');
    e.setRaw(1, 0, '=A1');
    e.deleteRows(0, 1);
    expect(e.getDisplay(0, 0)).toBe('#RIF!');
  });
});
