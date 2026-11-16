<!--
  Ribbon.svelte
  ---------------------------------------------------------------------------
  Interfaccia a "ribbon" (stile Office): una serie di schede e, per ogni
  scheda, gruppi di comandi. Ogni gruppo e' un blocco con titolo e pulsanti.
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import Icon from './Icon.svelte';
  import { listFunctions } from '../lib/functions.js';

  const TABS = [
    { id: 'home', label: 'Home' },
    { id: 'insert', label: 'Inserisci' },
    { id: 'data', label: 'Dati' },
    { id: 'calc', label: 'Calcolo' },
    { id: 'help', label: 'Aiuto' },
  ];

  const functions = listFunctions();
  let functionToInsert = $state('SOMMA');

  function insertFunction() {
    const def = functions.find((f) => f.name === functionToInsert);
    sheet.startEdit(`=${def ? def.name : functionToInsert}(`);
    sheet.setStatus(`Funzione ${functionToInsert} inserita: completa gli argomenti.`, 'info');
  }

  function toggleFormat(format) {
    const cell = sheet.engine.getCell(sheet.sel.r, sheet.sel.c);
    const current = cell?.style?.format ?? 'general';
    sheet.applyStyle({ format: current === format ? 'general' : format });
  }
</script>

<div class="ribbon">
  <div class="ribbon-tabs" role="tablist">
    {#each TABS as tab (tab.id)}
      <button
        class="ribbon-tab"
        class:active={sheet.ribbonTab === tab.id}
        role="tab"
        aria-selected={sheet.ribbonTab === tab.id}
        onclick={() => sheet.setRibbonTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="ribbon-body">
    <!-- ============================ HOME ============================ -->
    {#if sheet.ribbonTab === 'home'}
      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.newSheet()} title="Nuovo foglio vuoto">
            <Icon name="new" /><span class="label">Nuovo</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.loadLocal()} title="Carica dal browser">
            <Icon name="open" /><span class="label">Apri</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.saveLocal()} title="Salva nel browser">
            <Icon name="save" /><span class="label">Salva</span>
          </button>
        </div>
        <div class="ribbon-group-title">File</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" disabled={!sheet.canUndo} onclick={() => sheet.undo()} title="Annulla (Ctrl+Z)">
            <Icon name="undo" /><span class="label">Annulla</span>
          </button>
          <button class="ribbon-btn" disabled={!sheet.canRedo} onclick={() => sheet.redo()} title="Ripeti (Ctrl+Y)">
            <Icon name="redo" /><span class="label">Ripeti</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.copyCell()} title="Copia (Ctrl+C)">
            <Icon name="copy" /><span class="label">Copia</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.pasteCell()} title="Incolla (Ctrl+V)">
            <Icon name="paste" /><span class="label">Incolla</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.clearCell()} title="Cancella contenuto (Canc)">
            <Icon name="trash" /><span class="label">Cancella</span>
          </button>
        </div>
        <div class="ribbon-group-title">Modifica</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button
            class="ribbon-btn"
            class:active={sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.bold}
            onclick={() =>
              sheet.applyStyle({ bold: !sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.bold })}
            title="Grassetto"
          >
            <Icon name="bold" /><span class="label">Grassetto</span>
          </button>
          <button
            class="ribbon-btn"
            class:active={sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.italic}
            onclick={() =>
              sheet.applyStyle({
                italic: !sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.italic,
              })}
            title="Corsivo"
          >
            <Icon name="italic" /><span class="label">Corsivo</span>
          </button>
        </div>
        <div class="ribbon-group-title">Carattere</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button
            class="ribbon-btn"
            class:active={sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.align === 'left'}
            onclick={() => sheet.applyStyle({ align: 'left' })}
            title="Allinea a sinistra"
          >
            <Icon name="alignLeft" /><span class="label">Sinistra</span>
          </button>
          <button
            class="ribbon-btn"
            class:active={sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.align === 'center'}
            onclick={() => sheet.applyStyle({ align: 'center' })}
            title="Allinea al centro"
          >
            <Icon name="alignCenter" /><span class="label">Centro</span>
          </button>
          <button
            class="ribbon-btn"
            class:active={sheet.engine.getCell(sheet.sel.r, sheet.sel.c)?.style?.align === 'right'}
            onclick={() => sheet.applyStyle({ align: 'right' })}
            title="Allinea a destra"
          >
            <Icon name="alignRight" /><span class="label">Destra</span>
          </button>
        </div>
        <div class="ribbon-group-title">Allineamento</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => toggleFormat('general')} title="Formato generale">
            <Icon name="number" /><span class="label">Generale</span>
          </button>
          <button class="ribbon-btn" onclick={() => toggleFormat('dec2')} title="Due decimali">
            <span style="font-weight:700">0,0</span><span class="label">2 decimali</span>
          </button>
          <button class="ribbon-btn" onclick={() => toggleFormat('currency')} title="Valuta (EUR)">
            <Icon name="currency" /><span class="label">Euro</span>
          </button>
          <button class="ribbon-btn" onclick={() => toggleFormat('percent')} title="Percentuale">
            <Icon name="percent" /><span class="label">Percentuale</span>
          </button>
        </div>
        <div class="ribbon-group-title">Numero</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.insertRow()} title="Inserisci riga sopra">
            <Icon name="rowInsert" /><span class="label">Ins. riga</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.deleteRow()} title="Elimina riga">
            <Icon name="rowDelete" /><span class="label">Elim. riga</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.insertCol()} title="Inserisci colonna a sinistra">
            <Icon name="colInsert" /><span class="label">Ins. colonna</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.deleteCol()} title="Elimina colonna">
            <Icon name="colDelete" /><span class="label">Elim. colonna</span>
          </button>
        </div>
        <div class="ribbon-group-title">Celle</div>
      </div>
    {/if}

    <!-- ========================== INSERISCI ========================== -->
    {#if sheet.ribbonTab === 'insert'}
      <div class="ribbon-group">
        <div class="ribbon-items">
          <select bind:value={functionToInsert} style="max-width:190px;margin:0;font-size:0.72rem" aria-label="Funzione">
            {#each functions as fn (fn.name)}
              <option value={fn.name}>{fn.name} — {fn.signature}</option>
            {/each}
          </select>
          <button class="ribbon-btn" onclick={insertFunction} title="Inserisci la funzione scelta">
            <Icon name="function" /><span class="label">Inserisci</span>
          </button>
        </div>
        <div class="ribbon-group-title">Funzioni</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.insertRow()}>
            <Icon name="rowInsert" /><span class="label">Ins. riga</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.deleteRow()}>
            <Icon name="rowDelete" /><span class="label">Elim. riga</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.insertCol()}>
            <Icon name="colInsert" /><span class="label">Ins. colonna</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.deleteCol()}>
            <Icon name="colDelete" /><span class="label">Elim. colonna</span>
          </button>
        </div>
        <div class="ribbon-group-title">Righe e colonne</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn wide" onclick={() => sheet.loadDemo()}>
            <Icon name="grid" /><span class="label">Carica foglio di esempio</span>
          </button>
        </div>
        <div class="ribbon-group-title">Esempi</div>
      </div>
    {/if}

    <!-- ============================ DATI ============================ -->
    {#if sheet.ribbonTab === 'data'}
      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.exportCsv()} title="Esporta in CSV">
            <Icon name="download" /><span class="label">Esporta CSV</span>
          </button>
          <label class="ribbon-btn" title="Importa un file CSV">
            <Icon name="upload" /><span class="label">Importa CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              class="visually-hidden"
              onchange={async (e) => {
                const file = e.currentTarget.files?.[0];
                if (!file) return;
                const text = await file.text();
                sheet.importCsv(text);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <div class="ribbon-group-title">Importa / Esporta</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.saveLocal()}>
            <Icon name="save" /><span class="label">Salva</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.loadLocal()}>
            <Icon name="open" /><span class="label">Apri</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.newSheet()}>
            <Icon name="clear" /><span class="label">Svuota</span>
          </button>
        </div>
        <div class="ribbon-group-title">Archivio locale</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn wide" onclick={() => sheet.loadDemo()}>
            <Icon name="chart" /><span class="label">Dati di esempio</span>
          </button>
        </div>
        <div class="ribbon-group-title">Esempi</div>
      </div>
    {/if}

    <!-- =========================== CALCOLO =========================== -->
    {#if sheet.ribbonTab === 'calc'}
      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.recalcAll()} title="Ricalcola tutto">
            <Icon name="recalc" /><span class="label">Ricalcola</span>
          </button>
          <button
            class="ribbon-btn"
            class:active={sheet.autoRecalc}
            onclick={() => sheet.setAutoRecalc(!sheet.autoRecalc)}
            title="Ricalcolo automatico a ogni modifica"
          >
            <Icon name="function" /><span class="label">Auto-ricalcolo</span>
          </button>
        </div>
        <div class="ribbon-group-title">Motore di calcolo</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn wide" onclick={() => sheet.setAiOpen(!sheet.aiOpen)}>
            <Icon name="ai" /><span class="label">Assistente AI</span>
          </button>
          <button class="ribbon-btn wide" onclick={() => sheet.setHelpOpen(true)}>
            <Icon name="help" /><span class="label">Guida funzioni</span>
          </button>
        </div>
        <div class="ribbon-group-title">Assistente</div>
      </div>
    {/if}

    <!-- ============================ AIUTO ============================ -->
    {#if sheet.ribbonTab === 'help'}
      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.setHelpOpen(true)}>
            <Icon name="help" /><span class="label">Guida funzioni</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.setAiOpen(!sheet.aiOpen)}>
            <Icon name="ai" /><span class="label">Assistente AI</span>
          </button>
        </div>
        <div class="ribbon-group-title">Guida</div>
      </div>

      <div class="ribbon-sep"></div>

      <div class="ribbon-group">
        <div class="ribbon-items">
          <button class="ribbon-btn" onclick={() => sheet.toggleTheme()}>
            <Icon name="theme" /><span class="label">Tema</span>
          </button>
          <button class="ribbon-btn" onclick={() => sheet.setInstallPrompt(sheet.installEvent)} disabled={!sheet.installEvent}>
            <Icon name="install" /><span class="label">Installa</span>
          </button>
        </div>
        <div class="ribbon-group-title">Aspetto</div>
      </div>
    {/if}
  </div>
</div>
