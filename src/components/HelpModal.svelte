<!--
  HelpModal.svelte — guida alle funzioni disponibili e scorciatoie.
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import { listFunctions } from '../lib/functions.js';

  let dialogEl = $state(null);
  const functions = listFunctions();

  const grouped = $derived.by(() => {
    const map = new Map();
    for (const fn of functions) {
      if (!map.has(fn.category)) map.set(fn.category, []);
      map.get(fn.category).push(fn);
    }
    return [...map.entries()];
  });

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (sheet.helpOpen && !el.open) el.showModal();
    else if (!sheet.helpOpen && el.open) el.close();
  });

  const SHORTCUTS = [
    ['Frecce', 'Sposta la selezione'],
    ['Tab / Shift+Tab', 'Cella a destra / sinistra'],
    ['Invio / Shift+Invio', 'Conferma e scende / sale'],
    ['F2', 'Modifica il contenuto della cella'],
    ['Canc', 'Cancella il contenuto'],
    ['Ctrl+Z / Ctrl+Y', 'Annulla / Ripeti'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copia / Taglia / Incolla'],
    ['Ctrl+S', 'Salva nel browser'],
    ['Pag Su / Pag Giù', 'Scorre di una schermata'],
    ['Esc', 'Torna alla cella A1'],
  ];
</script>

<dialog
  class="sheet-dialog"
  bind:this={dialogEl}
  oncancel={() => sheet.setHelpOpen(false)}
  onclick={(e) => {
    if (e.target === dialogEl) sheet.setHelpOpen(false);
  }}
>
  <div class="dlg-head">
    <span>Guida — funzioni e scorciatoie</span>
    <span class="spacer"></span>
    <button class="secondary outline" onclick={() => sheet.setHelpOpen(false)}>Chiudi</button>
  </div>
  <div class="dlg-body">
    <h4 style="margin-top:0">Scorciatoie da tastiera</h4>
    <table class="fn-table">
      <tbody>
        {#each SHORTCUTS as [keys, desc] (keys)}
          <tr>
            <td style="width:220px"><code>{keys}</code></td>
            <td>{desc}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h4>Funzioni disponibili</h4>
    {#each grouped as [category, list] (category)}
      <h5 style="margin-bottom:0.3rem">{category}</h5>
      <table class="fn-table">
        <thead>
          <tr>
            <th style="width:130px">Funzione</th>
            <th style="width:250px">Firma</th>
            <th>Descrizione</th>
          </tr>
        </thead>
        <tbody>
          {#each list as fn (fn.name)}
            <tr>
              <td><code>{fn.name}</code></td>
              <td><code>{fn.signature}</code></td>
              <td>{fn.description}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/each}

    <h4>Sintassi delle formule</h4>
    <ul>
      <li>Gli argomenti sono separati dal <strong>punto e virgola</strong>: <code>=SOMMA(A1:A10;B1:B10)</code></li>
      <li>Il separatore decimale è il <strong>punto</strong>: <code>=A1*1,5</code> non è valido, scrivi <code>=A1*1.5</code></li>
      <li>Gli intervalli si scrivono <code>A1:B5</code>, anche su piu' colonne (<code>A1:CV100</code>)</li>
      <li>Le funzioni condizionali usano un criterio tra virgolette: <code>=CONTA.SE(A1:A10;"&gt;5")</code></li>
      <li>Operatori: <code>+ - * / ^</code> e la concatenazione <code>&amp;</code></li>
    </ul>
  </div>
</dialog>
