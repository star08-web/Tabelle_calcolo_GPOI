<!--
  SheetGrid.svelte
  ---------------------------------------------------------------------------
  Griglia virtualizzata: nel DOM viene disegnata SOLO la finestra di celle
  visibile (tipicamente ~35 righe x ~12 colonne = ~420 elementi), anche se il
  foglio contiene 100x100 = 10.000 celle.

  Strategia:
    - la finestra visibile e' calcolata da scrollTop/scrollLeft (con un
      margine di overscan per evitare lo "scrolling a scatti");
    - le celle sono posizionate in modo assoluto dentro un canvas whose
      dimensioni corrispondono all'intera griglia (per le scrollbar);
    - le intestazioni (colonne/righe) vivono in contenitori separati con
      overflow nascosto, sincronizzati con lo scroll del corpo griglia;
    - il ricalcolo e' incrementale: l'engine aggiorna solo le dipendenti e
      invalida la finestra tramite un contatore di "revisione".
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import { cellKey, colToLetters } from '../lib/coordinates.js';

  const ROW_H = 26;
  const COL_W = 104;
  const OVERSCAN = 4;

  const engine = sheet.engine;

  let bodyEl = $state(null);
  let colHeadEl = $state(null);
  let rowHeadEl = $state(null);
  let editorEl = $state(null);

  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewportH = $state(600);
  let viewportW = $state(900);

  /* ---------------- finestra visibile ---------------- */

  let firstRow = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  let lastRow = $derived(
    Math.min(engine.rows - 1, Math.floor((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  );
  let firstCol = $derived(Math.max(0, Math.floor(scrollLeft / COL_W) - OVERSCAN));
  let lastCol = $derived(
    Math.min(engine.cols - 1, Math.floor((scrollLeft + viewportW) / COL_W) + OVERSCAN)
  );

  let canvasW = $derived(engine.cols * COL_W);
  let canvasH = $derived(engine.rows * ROW_H);

  /* ---------------- dati delle celle della finestra ---------------- */

  let cells = $derived.by(() => {
    // La revisione del foglio e' la dipendenza reattiva: quando il motore
    // ricalcola qualcosa, la finestra viene ridisegnata.
    sheet.revision;
    const rect = sheet.selection;
    const out = [];
    for (let r = firstRow; r <= lastRow; r++) {
      for (let c = firstCol; c <= lastCol; c++) {
        const cell = engine.getCell(r, c);
        const value = cell ? cell.value : null;
        out.push({
          key: cellKey(r, c),
          r,
          c,
          left: c * COL_W,
          top: r * ROW_H,
          text: engine.getDisplay(r, c),
          formula: cell?.ast ? true : false,
          bold: !!cell?.style?.bold,
          italic: !!cell?.style?.italic,
          align: cell?.style?.align ?? 'left',
          numeric: typeof value === 'number',
          error: engine.getError(r, c),
          inRange:
            r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2,
        });
      }
    }
    return out;
  });

  /** Rettangolo evidenziato (bordo esterno) quando la selezione e' multipla. */
  let rangeBox = $derived.by(() => {
    const rect = sheet.selection;
    if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return null;
    return {
      left: rect.c1 * COL_W,
      top: rect.r1 * ROW_H,
      width: (rect.c2 - rect.c1 + 1) * COL_W,
      height: (rect.r2 - rect.r1 + 1) * ROW_H,
    };
  });

  let colLabels = $derived.by(() => {
    const out = [];
    for (let c = firstCol; c <= lastCol; c++) {
      out.push({ c, text: colToLetters(c), left: c * COL_W });
    }
    return out;
  });

  let rowLabels = $derived.by(() => {
    const out = [];
    for (let r = firstRow; r <= lastRow; r++) {
      out.push({ r, text: String(r + 1), top: r * ROW_H });
    }
    return out;
  });

  /* ---------------- scorrimento ---------------- */

  function onScroll() {
    if (!bodyEl) return;
    scrollTop = bodyEl.scrollTop;
    scrollLeft = bodyEl.scrollLeft;
    // Sincronizza le intestazioni con il corpo griglia.
    if (colHeadEl) colHeadEl.scrollLeft = bodyEl.scrollLeft;
    if (rowHeadEl) rowHeadEl.scrollTop = bodyEl.scrollTop;
  }

  /** Porta la cella selezionata dentro la vista. */
  function scrollIntoView(r, c) {
    if (!bodyEl) return;
    const top = r * ROW_H;
    const left = c * COL_W;
    if (top < bodyEl.scrollTop) {
      bodyEl.scrollTop = top;
    } else if (top + ROW_H > bodyEl.scrollTop + bodyEl.clientHeight) {
      bodyEl.scrollTop = top + ROW_H - bodyEl.clientHeight;
    }
    if (left < bodyEl.scrollLeft) {
      bodyEl.scrollLeft = left;
    } else if (left + COL_W > bodyEl.scrollLeft + bodyEl.clientWidth) {
      bodyEl.scrollLeft = left + COL_W - bodyEl.clientWidth;
    }
  }

  $effect(() => {
    const { r, c } = sheet.sel;
    scrollIntoView(r, c);
  });

  $effect(() => {
    if (!bodyEl) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      viewportH = rect.height;
      viewportW = rect.width;
    });
    observer.observe(bodyEl);
    viewportH = bodyEl.clientHeight;
    viewportW = bodyEl.clientWidth;
    return () => observer.disconnect();
  });

  /* ---------------- interazione ---------------- */

  function focusGrid() {
    bodyEl?.focus({ preventScroll: true });
  }

  function onCellClick(r, c, event) {
    if (event?.shiftKey) {
      // Shift+clic: estende la selezione a partire dalla cella attiva.
      sheet.selectRange(sheet.sel.r, sheet.sel.c, r, c);
    } else {
      sheet.select(r, c);
    }
    focusGrid();
  }

  function onCellDblClick(r, c) {
    sheet.select(r, c);
    sheet.startEdit();
    focusGrid();
  }

  /* ---------------- selezione con trascinamento ---------------- */

  let dragging = $state(false);
  let dragAnchor = null;

  /** Determina la cella sotto il puntatore. */
  function cellFromPoint(clientX, clientY) {
    if (!bodyEl) return null;
    const rect = bodyEl.getBoundingClientRect();
    const x = clientX - rect.left + bodyEl.scrollLeft;
    const y = clientY - rect.top + bodyEl.scrollTop;
    const c = Math.floor(x / COL_W);
    const r = Math.floor(y / ROW_H);
    if (r < 0 || c < 0 || r >= engine.rows || c >= engine.cols) return null;
    return { r, c };
  }

  function onPointerDown(r, c, event) {
    if (event.button !== 0) return;
    dragAnchor = { r, c };
    dragging = true;
    sheet.select(r, c);
  }

  function onPointerMove(event) {
    if (!dragging || !dragAnchor) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    sheet.selectRange(dragAnchor.r, dragAnchor.c, cell.r, cell.c);
  }

  function onPointerUp() {
    dragging = false;
    dragAnchor = null;
  }

  /** Tastiera su una singola cella (accessibilita'): Invio/F2 modificano. */
  function onCellKeydown(event, r, c) {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      sheet.select(r, c);
      sheet.startEdit();
    }
  }

  /** Tastiera sulle intestazioni: le frecce spostano la selezione. */
  function onHeaderKeydown(event, r, c) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      sheet.select(r, c);
      focusGrid();
    }
  }

  function onKeydown(event) {
    if (sheet.editor) return; // l'editor gestisce i tasti
    const key = event.key;

    // Le scorciatoie con Ctrl/Cmd sono gestite a livello di finestra
    // (vedi App.svelte) cosi' funzionano anche con il focus sulla ribbon.
    if (event.ctrlKey || event.metaKey) {
      if (key === 'Home') {
        event.preventDefault();
        sheet.select(0, 0);
      }
      return;
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        sheet.moveSelection(-1, 0);
        break;
      case 'ArrowDown':
        event.preventDefault();
        sheet.moveSelection(1, 0);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        sheet.moveSelection(0, -1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        sheet.moveSelection(0, 1);
        break;
      case 'Tab':
        event.preventDefault();
        sheet.moveSelection(0, event.shiftKey ? -1 : 1);
        break;
      case 'Enter':
        event.preventDefault();
        sheet.moveSelection(event.shiftKey ? -1 : 1, 0);
        break;
      case 'F2':
        event.preventDefault();
        sheet.startEdit();
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        sheet.clearCell();
        break;
      case 'Escape':
        event.preventDefault();
        sheet.select(0, 0);
        break;
      case 'Home':
        event.preventDefault();
        sheet.select(sheet.sel.r, 0);
        break;
      case 'PageDown':
        event.preventDefault();
        sheet.moveSelection(Math.max(1, Math.floor(viewportH / ROW_H) - 1), 0);
        break;
      case 'PageUp':
        event.preventDefault();
        sheet.moveSelection(-Math.max(1, Math.floor(viewportH / ROW_H) - 1), 0);
        break;
      default:
        // Un carattere stampabile avvia la digitazione diretta nella cella.
        if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          sheet.startEdit(key);
        }
        break;
    }
  }

  /* ---------------- editor inline ---------------- */

  let editorStyle = $derived.by(() => {
    const ed = sheet.editor;
    if (!ed) return '';
    const w = Math.max(COL_W, 160);
    return `left:${ed.c * COL_W}px;top:${ed.r * ROW_H}px;width:${w}px;height:${ROW_H}px;`;
  });

  $effect(() => {
    if (sheet.editor && editorEl) {
      editorEl.focus();
      const len = editorEl.value.length;
      try {
        editorEl.setSelectionRange(len, len);
      } catch {
        /* input non testuale: ignora */
      }
    }
  });

  function onEditorKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      sheet.commitEdit();
      sheet.moveSelection(event.shiftKey ? -1 : 1, 0);
      focusGrid();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      sheet.cancelEdit();
      focusGrid();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      sheet.commitEdit();
      sheet.moveSelection(0, event.shiftKey ? -1 : 1);
      focusGrid();
    }
  }
</script>

<div class="sheet">
  <div class="sheet-corner" title="Foglio 1">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 4h16v16H4z" />
      <path d="M4 10h16M10 4v16" />
    </svg>
  </div>

  <div class="sheet-colhead" bind:this={colHeadEl}>
    <div class="sheet-canvas" style="width:{canvasW}px;height:28px">
      {#each colLabels as label (label.c)}
        <div
          class="hcell col"
          class:active={label.c === sheet.sel.c}
          style="left:{label.left}px;width:{COL_W}px"
          role="columnheader"
          tabindex="-1"
          onclick={() => sheet.select(sheet.sel.r, label.c)}
          onkeydown={(e) => onHeaderKeydown(e, sheet.sel.r, label.c)}
        >
          {label.text}
        </div>
      {/each}
    </div>
  </div>

  <div class="sheet-rowhead" bind:this={rowHeadEl}>
    <div class="sheet-canvas" style="width:58px;height:{canvasH}px">
      {#each rowLabels as label (label.r)}
        <div
          class="hcell row"
          class:active={label.r === sheet.sel.r}
          style="top:{label.top}px"
          role="rowheader"
          tabindex="-1"
          onclick={() => sheet.select(label.r, sheet.sel.c)}
          onkeydown={(e) => onHeaderKeydown(e, label.r, sheet.sel.c)}
        >
          {label.text}
        </div>
      {/each}
    </div>
  </div>

  <div
    class="sheet-body"
    bind:this={bodyEl}
    onscroll={onScroll}
    onkeydown={onKeydown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={onPointerUp}
    tabindex="0"
    role="grid"
    aria-label="Griglia del foglio di calcolo"
  >
    <div class="sheet-canvas" style="width:{canvasW}px;height:{canvasH}px">
      {#each cells as cell (cell.key)}
        <div
          class="cell"
          class:number={cell.numeric}
          class:text={!cell.numeric}
          class:formula={cell.formula}
          class:selected={cell.r === sheet.sel.r && cell.c === sheet.sel.c}
          class:in-row={cell.r === sheet.sel.r}
          class:in-col={cell.c === sheet.sel.c}
          class:in-range={cell.inRange && !cell.selected}
          class:error={!!cell.error}
          class:bold={cell.bold}
          class:italic={cell.italic}
          class:align-center={cell.align === 'center'}
          class:align-right={cell.align === 'right'}
          style="left:{cell.left}px;top:{cell.top}px;width:{COL_W}px;height:{ROW_H}px;"
          title={cell.error ? `${cell.error.code} — ${cell.error.detail ?? ''}` : ''}
          role="gridcell"
          tabindex="-1"
          onpointerdown={(e) => onPointerDown(cell.r, cell.c, e)}
          onclick={(e) => onCellClick(cell.r, cell.c, e)}
          ondblclick={() => onCellDblClick(cell.r, cell.c)}
          onkeydown={(e) => onCellKeydown(e, cell.r, cell.c)}
        >
          {cell.text}
        </div>
      {/each}

      {#if rangeBox}
        <div
          class="selection-range"
          style="left:{rangeBox.left}px;top:{rangeBox.top}px;width:{rangeBox.width}px;height:{rangeBox.height}px;"
        ></div>
      {/if}

      {#if sheet.editor}
        <input
          class="cell-editor"
          style={editorStyle}
          value={sheet.editor.value}
          oninput={(e) => sheet.updateEditor(e.currentTarget.value)}
          onkeydown={onEditorKeydown}
          onblur={() => sheet.commitEdit()}
          spellcheck="false"
          autocomplete="off"
          aria-label="Modifica cella"
          bind:this={editorEl}
        />
      {/if}
    </div>
  </div>
</div>
