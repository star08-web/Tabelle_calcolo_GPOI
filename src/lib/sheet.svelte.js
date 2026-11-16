/**
 * sheet.svelte.js
 * ---------------------------------------------------------------------------
 * Store reattivo dell'applicazione (Svelte 5 runes).
 *
 * Il motore di calcolo (`engine.js`) resta deliberatamente "puro" e non
 * reattivo: e' testabile con Vitest e non mantiene alcun riferimento al
 * framework. Questo modulo fa da ponte tra il motore e la UI:
 *
 *   - espone lo stato di selezione, modifica, ribbon, pannello AI;
 *   - mantiene lo storico (undo/redo) delle modifiche;
 *   - sincronizza la persistenza su localStorage.
 *
 * Per non far scattare il reactivity system su 10.000 celle si usa un
 * contatore `revision`: quando il motore modifica qualcosa si incrementa la
 * revisione e i componenti ricalcolano solo la finestra visibile.
 */

import { SheetEngine } from './engine.js';
import { cellName, fromKey, cellKey } from './coordinates.js';
import {
  saveSheet,
  loadSheet,
  savePrefs,
  loadPrefs,
  sheetToCsv,
  parseCsv,
  downloadText,
  clearSavedSheet,
} from './storage.js';

/** Ritardo (ms) del salvataggio automatico su localStorage. */
const AUTOSAVE_DELAY = 600;

function createSheetStore() {
  const engine = new SheetEngine({ rows: 100, cols: 100 });

  /* ---------------- stato reattivo ---------------- */
  let revision = $state(0);
  let sel = $state({ r: 0, c: 0 }); // cella attiva
  let selEnd = $state({ r: 0, c: 0 }); // angolo opposto della selezione
  let editor = $state(null); // { r, c, value }
  let status = $state({ text: 'Pronto', kind: 'info' });
  let ribbonTab = $state('home');
  let aiOpen = $state(false);
  let aiTab = $state('offline');
  let helpOpen = $state(false);
  let autoRecalc = $state(true);
  let theme = $state('light');
  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  let swReady = $state(false);
  let historyVersion = $state(0);
  let installEvent = $state(null);
  let showInstallBanner = $state(false);

  /* ---------------- storico (non reattivo) ---------------- */
  const undoStack = [];
  const redoStack = [];
  let saveTimer = null;

  /* ---------------- helper interni ---------------- */

  function bump() {
    revision++;
  }

  // Ogni modifica del motore invalida la finestra visualizzata: questo
  // collegamento e' il ponte tra il motore (non reattivo) e la UI (reattiva).
  engine.onChange(() => {
    revision++;
  });

  function setStatus(text, kind = 'info') {
    status = { text, kind };
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveSheet(engine);
    }, AUTOSAVE_DELAY);
  }

  function pushHistory(action) {
    undoStack.push(action);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    historyVersion++;
  }

  /* ---------------- selezione ---------------- */

  function select(r, c) {
    const maxR = engine.rows - 1;
    const maxC = engine.cols - 1;
    const rr = Math.min(Math.max(r, 0), maxR);
    const cc = Math.min(Math.max(c, 0), maxC);
    sel = { r: rr, c: cc };
    selEnd = { r: rr, c: cc };
  }

  function moveSelection(dr, dc) {
    select(sel.r + dr, sel.c + dc);
  }

  /**
   * Seleziona un rettangolo di celle (trascinamento o Shift+clic).
   * La cella attiva resta quella di partenza.
   */
  function selectRange(r1, c1, r2, c2) {
    const maxR = engine.rows - 1;
    const maxC = engine.cols - 1;
    const a = {
      r: Math.min(Math.max(r1, 0), maxR),
      c: Math.min(Math.max(c1, 0), maxC),
    };
    const b = {
      r: Math.min(Math.max(r2, 0), maxR),
      c: Math.min(Math.max(c2, 0), maxC),
    };
    sel = a;
    selEnd = b;
  }

  /** Rettangolo di selezione normalizzato. */
  function currentSelection() {
    return {
      r1: Math.min(sel.r, selEnd.r),
      c1: Math.min(sel.c, selEnd.c),
      r2: Math.max(sel.r, selEnd.r),
      c2: Math.max(sel.c, selEnd.c),
    };
  }

  /** Il rettangolo comprende piu' di una cella? */
  function isMultiSelection() {
    const rect = currentSelection();
    return rect.r1 !== rect.r2 || rect.c1 !== rect.c2;
  }

  /* ---------------- modifica delle celle ---------------- */

  /**
   * Scrive il contenuto di una cella, registrando l'azione per l'undo.
   * @param {number} r
   * @param {number} c
   * @param {string} raw
   */
  function setCell(r, c, raw, options = {}) {
    const before = engine.getRaw(r, c);
    if (before === raw) {
      if (options.select !== false) select(r, c);
      return;
    }
    if (options.record !== false) {
      pushHistory({ type: 'cells', entries: [{ r, c, before, after: raw }] });
    }
    engine.setRaw(r, c, raw);
    bump();
    scheduleSave();
    if (options.select !== false) select(r, c);
    const err = engine.getError(r, c);
    if (err) {
      setStatus(`${cellName(r, c)}: ${err.code}${err.detail ? ' — ' + err.detail : ''}`, 'error');
    }
  }

  /** Applica una formattazione a tutte le celle della selezione. */
  function applyStyle(patch) {
    const rect = currentSelection();
    const before = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        const style = engine.getCell(r, c)?.style ?? {};
        before.push({ r, c, style: { ...style } });
        engine.setStyle(r, c, patch);
      }
    }
    pushHistory({
      type: 'styles',
      entries: before.map((b) => ({ ...b, after: { ...b.style, ...patch } })),
    });
    bump();
    scheduleSave();
  }

  function clearCell() {
    const rect = currentSelection();
    const entries = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) {
        const before = engine.getRaw(r, c);
        if (before === '') continue;
        entries.push({ r, c, before, after: '' });
      }
    }
    if (!entries.length) return;
    pushHistory({ type: 'cells', entries });
    for (const entry of entries) engine.setRaw(entry.r, entry.c, '');
    bump();
    scheduleSave();
    setStatus(
      entries.length > 1
        ? `${entries.length} celle cancellate.`
        : `Cella ${cellName(sel.r, sel.c)} cancellata.`,
      'info'
    );
  }

  /* ---------------- editing ---------------- */

  function startEdit(seed) {
    const { r, c } = sel;
    const initial = seed !== undefined ? seed : engine.getRaw(r, c);
    editor = { r, c, value: initial };
  }

  function updateEditor(value) {
    if (!editor) return;
    editor = { ...editor, value };
  }

  function cancelEdit() {
    editor = null;
  }

  function commitEdit(value) {
    if (!editor) return;
    const { r, c } = editor;
    const text = value !== undefined ? value : editor.value;
    editor = null;
    setCell(r, c, text);
  }

  /* ---------------- undo / redo ---------------- */

  function undo() {
    const action = undoStack.pop();
    if (!action) {
      setStatus('Nessuna azione da annullare.', 'info');
      return;
    }
    applyInverse(action);
    redoStack.push(action);
    historyVersion++;
    bump();
    scheduleSave();
    setStatus('Azione annullata.', 'info');
  }

  function redo() {
    const action = redoStack.pop();
    if (!action) {
      setStatus('Nessuna azione da ripetere.', 'info');
      return;
    }
    applyForward(action);
    undoStack.push(action);
    historyVersion++;
    bump();
    scheduleSave();
    setStatus('Azione ripetuta.', 'info');
  }

  function applyInverse(action) {
    if (action.type === 'cells') {
      for (const entry of action.entries) engine.setRaw(entry.r, entry.c, entry.before);
    } else if (action.type === 'style') {
      engine.setStyle(action.r, action.c, action.before);
    } else if (action.type === 'styles') {
      for (const entry of action.entries) engine.setStyle(entry.r, entry.c, entry.style);
    } else if (action.type === 'snapshot') {
      engine.fromJSON(action.before);
    }
  }

  function applyForward(action) {
    if (action.type === 'cells') {
      for (const entry of action.entries) engine.setRaw(entry.r, entry.c, entry.after);
    } else if (action.type === 'style') {
      engine.setStyle(action.r, action.c, action.after);
    } else if (action.type === 'styles') {
      for (const entry of action.entries) engine.setStyle(entry.r, entry.c, entry.after);
    } else if (action.type === 'snapshot') {
      engine.fromJSON(action.after);
    }
  }

  /* ---------------- copia / incolla (clipboard interno) ---------------- */

  let clipboard = $state(null); // { r, c, raw }

  function copyCell() {
    clipboard = { r: sel.r, c: sel.c, raw: engine.getRaw(sel.r, sel.c) };
    setStatus(`Cella ${cellName(sel.r, sel.c)} copiata.`, 'info');
  }

  function cutCell() {
    clipboard = { r: sel.r, c: sel.c, raw: engine.getRaw(sel.r, sel.c) };
    setCell(sel.r, sel.c, '');
    setStatus(`Cella ${cellName(sel.r, sel.c)} tagliata.`, 'info');
  }

  function pasteCell() {
    if (!clipboard) {
      setStatus('Clipboard vuoto.', 'info');
      return;
    }
    setCell(sel.r, sel.c, clipboard.raw);
    setStatus(`Cella ${cellName(sel.r, sel.c)} incollata.`, 'ok');
  }

  /* ---------------- operazioni strutturali ---------------- */

  function snapshotAction() {
    return { type: 'snapshot', before: engine.toJSON(), after: null };
  }

  function structural(fn, message) {
    const action = snapshotAction();
    fn();
    action.after = engine.toJSON();
    pushHistory(action);
    bump();
    scheduleSave();
    setStatus(message, 'info');
  }

  function insertRow(at = sel.r) {
    structural(() => engine.insertRows(at, 1), `Riga inserita prima della riga ${at + 1}.`);
  }

  function deleteRow(at = sel.r) {
    structural(() => engine.deleteRows(at, 1), `Riga ${at + 1} eliminata.`);
  }

  function insertCol(at = sel.c) {
    structural(() => engine.insertCols(at, 1), `Colonna inserita prima della colonna ${cellName(0, at).replace(/\d+/g, '')}.`);
  }

  function deleteCol(at = sel.c) {
    structural(() => engine.deleteCols(at, 1), `Colonna eliminata.`);
  }

  /* ---------------- file e persistenza ---------------- */

  function recalcAll() {
    const changed = engine.recalcAll();
    bump();
    scheduleSave();
    setStatus(`Ricalcolo completato (${changed.length} celle aggiornate).`, 'ok');
  }

  function newSheet() {
    const action = snapshotAction();
    engine.clearAll();
    action.after = engine.toJSON();
    pushHistory(action);
    select(0, 0);
    bump();
    scheduleSave();
    setStatus('Nuovo foglio vuoto.', 'ok');
  }

  function saveLocal() {
    const ok = saveSheet(engine);
    setStatus(ok ? 'Foglio salvato nel browser.' : 'Salvataggio non riuscito.', ok ? 'ok' : 'error');
  }

  function loadLocal() {
    const data = loadSheet();
    if (!data) {
      setStatus('Nessun foglio salvato trovato.', 'error');
      return;
    }
    const action = snapshotAction();
    engine.fromJSON(data);
    action.after = engine.toJSON();
    pushHistory(action);
    select(0, 0);
    bump();
    setStatus('Foglio caricato dal browser.', 'ok');
  }

  function exportCsv() {
    const csv = sheetToCsv(engine);
    if (!csv) {
      setStatus('Il foglio e\' vuoto: niente da esportare.', 'info');
      return;
    }
    downloadText('mini-foglio.csv', csv);
    setStatus('Esportazione CSV completata.', 'ok');
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) {
      setStatus('Il file CSV e\' vuoto.', 'error');
      return;
    }
    const action = snapshotAction();
    engine.clearAll();
    rows.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== '' && r < engine.rows && c < engine.cols) {
          engine.setRaw(r, c, value);
        }
      });
    });
    action.after = engine.toJSON();
    pushHistory(action);
    select(0, 0);
    bump();
    scheduleSave();
    setStatus(`Importate ${rows.length} righe da CSV.`, 'ok');
  }

  /** Carica un piccolo foglio di esempio (utile per la demo). */
  function loadDemo() {
    const action = snapshotAction();
    engine.clearAll();
    const demo = [
      ['Prodotto', 'Quantita\'', 'Prezzo', 'Totale'],
      ['Tastiera', '12', '45,5', '=B2*C2'],
      ['Mouse', '30', '18,25', '=B3*C3'],
      ['Monitor', '8', '199,9', '=B4*C4'],
      ['Cuffie', '15', '79,5', '=B5*C5'],
      ['', '', 'Totale', '=SOMMA(D2:D5)'],
      ['', '', 'Media', '=MEDIA(D2:D5)'],
      ['', '', 'Max', '=MAX(D2:D5)'],
      ['', '', 'Quantita\' > 10', '=CONTA.SE(B2:B5;">10")'],
      ['', '', 'Valore > 1000', '=SOMMA.SE(D2:D5;">1000")'],
    ];
    demo.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== '') engine.setRaw(r, c, value);
      });
    });
    action.after = engine.toJSON();
    pushHistory(action);
    select(0, 0);
    bump();
    scheduleSave();
    setStatus('Dati di esempio caricati.', 'ok');
  }

  /* ---------------- preferenze ---------------- */

  function setTheme(next) {
    theme = next;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
    savePrefs({ theme, autoRecalc });
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }

  function setAutoRecalc(value) {
    autoRecalc = value;
    savePrefs({ theme, autoRecalc });
  }

  function restorePrefs() {
    const prefs = loadPrefs();
    if (prefs?.theme) setTheme(prefs.theme);
    if (typeof prefs?.autoRecalc === 'boolean') autoRecalc = prefs.autoRecalc;
  }

  /* ---------------- API pubblica ---------------- */

  return {
    engine,
    // stato
    get revision() {
      return revision;
    },
    get sel() {
      return sel;
    },
    get selection() {
      return currentSelection();
    },
    get multiSelection() {
      return isMultiSelection();
    },
    get editor() {
      return editor;
    },
    get status() {
      return status;
    },
    get ribbonTab() {
      return ribbonTab;
    },
    get aiOpen() {
      return aiOpen;
    },
    get aiTab() {
      return aiTab;
    },
    get helpOpen() {
      return helpOpen;
    },
    get autoRecalc() {
      return autoRecalc;
    },
    get theme() {
      return theme;
    },
    get online() {
      return online;
    },
    get swReady() {
      return swReady;
    },
    get installEvent() {
      return installEvent;
    },
    get showInstallBanner() {
      return showInstallBanner;
    },
    get canUndo() {
      historyVersion;
      return undoStack.length > 0;
    },
    get canRedo() {
      historyVersion;
      return redoStack.length > 0;
    },
    // azioni
    select,
    selectRange,
    moveSelection,
    setCell,
    applyStyle,
    clearCell,
    startEdit,
    updateEditor,
    cancelEdit,
    commitEdit,
    undo,
    redo,
    copyCell,
    cutCell,
    pasteCell,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    recalcAll,
    newSheet,
    saveLocal,
    loadLocal,
    exportCsv,
    importCsv,
    loadDemo,
    setStatus,
    setTheme,
    toggleTheme,
    setAutoRecalc,
    restorePrefs,
    setRibbonTab(tab) {
      ribbonTab = tab;
    },
    setAiOpen(open) {
      aiOpen = open;
    },
    setAiTab(tab) {
      aiTab = tab;
    },
    setHelpOpen(open) {
      helpOpen = open;
    },
    setOnline(value) {
      online = value;
    },
    setSwReady(value) {
      swReady = value;
    },
    setInstallEvent(event) {
      installEvent = event;
      showInstallBanner = !!event;
    },
    dismissInstallBanner() {
      showInstallBanner = false;
    },
  };
}

export const sheet = createSheetStore();
export { cellKey, fromKey, cellName };
