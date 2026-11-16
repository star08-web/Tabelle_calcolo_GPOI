<!--
  StatusBar.svelte — barra di stato con le informazioni sulla cella
  selezionata e sullo stato dell'applicazione.
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import { cellName } from '../lib/coordinates.js';
  import { isError, isBlank } from '../lib/values.js';

  const engine = sheet.engine;

  let info = $derived.by(() => {
    sheet.revision;
    const { r, c } = sheet.sel;
    const cell = engine.getCell(r, c);
    const value = cell ? cell.value : null;
    const raw = cell ? cell.raw : '';
    const error = isError(value) ? value : null;

    let type = 'Vuota';
    if (!isBlank(value)) {
      if (error) type = 'Errore';
      else if (typeof value === 'number') type = 'Numero';
      else if (typeof value === 'boolean') type = 'Booleano';
      else type = 'Testo';
    }

    // Statistiche sull'intera selezione (una cella o un intervallo).
    const rect = sheet.selection;
    let count = 0;
    let numeric = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let rr = rect.r1; rr <= rect.r2; rr++) {
      for (let cc = rect.c1; cc <= rect.c2; cc++) {
        const v = engine.getValue(rr, cc);
        count++;
        if (typeof v === 'number' && Number.isFinite(v)) {
          numeric++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    return {
      address: cellName(r, c),
      type,
      error,
      raw,
      display: engine.getDisplay(r, c),
      filled: engine.cells.size,
      multi: sheet.multiSelection,
      stats: { count, numeric, sum, min, max },
    };
  });
</script>

<div class="statusbar">
  <span class="chip">{info.address}</span>
  <span>{info.type}</span>
  {#if info.error}
    <span class="chip err" title={info.error.detail}>{info.error.code}</span>
    <span>{info.error.detail}</span>
  {:else}
    <span title="Valore visualizzato">{info.display}</span>
  {/if}

  {#if info.multi}
    <span class="chip" title="Numero di celle selezionate">
      {info.stats.count} celle
    </span>
    <span title="Somma dei valori numerici">SOMMA: {info.stats.sum}</span>
    <span title="Media dei valori numerici">
      MEDIA: {info.stats.numeric ? (info.stats.sum / info.stats.numeric) : 0}
    </span>
    <span title="Minimo">MIN: {info.stats.numeric ? info.stats.min : 0}</span>
    <span title="Massimo">MAX: {info.stats.numeric ? info.stats.max : 0}</span>
  {/if}

  <span class="spacer"></span>

  <span title="Numero di celle con contenuto">
    {info.filled} celle
  </span>
  <span class="chip" class:ok={sheet.online} class:err={!sheet.online}>
    {sheet.online ? 'Online' : 'Offline'}
  </span>
  <span title="Il motore ricalcola solo le celle dipendenti dalle modifiche">
    Ricalcolo incrementale attivo
  </span>
</div>
