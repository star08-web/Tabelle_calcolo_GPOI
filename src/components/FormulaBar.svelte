<!--
  FormulaBar.svelte — barra delle formule: mostra il contenuto grezzo della
  cella selezionata e permette di modificarlo.
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import { cellName } from '../lib/coordinates.js';
  import { parseFormula } from '../lib/parser.js';

  const engine = sheet.engine;
  let text = $state('');
  let focused = $state(false);

  /** Indirizzo mostrato nel "name box": singola cella o intervallo. */
  let address = $derived.by(() => {
    const rect = sheet.selection;
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) {
      return cellName(sheet.sel.r, sheet.sel.c);
    }
    return `${cellName(rect.r1, rect.c1)}:${cellName(rect.r2, rect.c2)}`;
  });

  // Sincronizza il testo con la cella selezionata (o con l'editor inline).
  $effect(() => {
    sheet.revision;
    if (focused) return;
    const ed = sheet.editor;
    text = ed ? ed.value : engine.getRaw(sheet.sel.r, sheet.sel.c);
  });

  /** La formula scritta e' sintatticamente valida? */
  let invalid = $derived.by(() => {
    const value = text.trim();
    if (!value.startsWith('=')) return false;
    try {
      parseFormula(value);
      return false;
    } catch {
      return true;
    }
  });

  function commit() {
    focused = false;
    const { r, c } = sheet.sel;
    sheet.setCell(r, c, text);
  }

  function onKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      sheet.moveSelection(1, 0);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      focused = false;
      text = engine.getRaw(sheet.sel.r, sheet.sel.c);
      event.currentTarget.blur();
    }
  }
</script>

<div class="formula-bar">
  <div class="name-box" title="Indirizzo della cella selezionata">{address}</div>
  <div class="fx-box" title="Funzione / costante">fx</div>
  <input
    type="text"
    class:invalid={invalid}
    bind:value={text}
    onfocus={() => (focused = true)}
    onblur={commit}
    onkeydown={onKeydown}
    spellcheck="false"
    autocomplete="off"
    aria-label="Barra delle formule"
    placeholder="Inserisci un valore o una formula (es. =SOMMA(A1:A10))"
  />
</div>
