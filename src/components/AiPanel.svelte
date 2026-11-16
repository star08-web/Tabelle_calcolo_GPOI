<!--
  AiPanel.svelte
  ---------------------------------------------------------------------------
  Pannello "Assistente AI".

  Modalita' OFFLINE (predefinita): analisi, spiegazione e generazione di
  formule eseguite interamente nel browser. Nessun dato lascia il dispositivo.

  Modalita' ONLINE (opzionale): permette di usare un endpoint
  OpenAI-compatible con una chiave fornita esplicitamente dall'utente.
  E' disattivata di default e viene invocata solo su richiesta esplicita.
-->
<script>
  import { sheet } from '../lib/sheet.svelte.js';
  import {
    generateFormula,
    explainFormula,
    suggestForSelection,
    analyzeSheet,
    refactorFormula,
    callOnlineAI,
  } from '../lib/ai.js';
  import { cellName } from '../lib/coordinates.js';

  const engine = sheet.engine;
  const SETTINGS_KEY = 'mini-sheet-pwa/ai';

  let request = $state('');
  let output = $state('');
  let busy = $state(false);

  // --- impostazioni online (facoltative) ---
  let endpoint = $state('');
  let apiKey = $state('');
  let model = $state('gpt-4o-mini');
  let onlinePrompt = $state('');

  $effect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      endpoint = cfg.endpoint ?? endpoint;
      apiKey = cfg.apiKey ?? apiKey;
      model = cfg.model ?? model;
    } catch {
      /* ignorato */
    }
  });

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ endpoint, apiKey, model })
      );
      sheet.setStatus('Impostazioni AI salvate nel browser.', 'ok');
    } catch {
      sheet.setStatus('Impossibile salvare le impostazioni AI.', 'error');
    }
  }

  function currentAddress() {
    return cellName(sheet.sel.r, sheet.sel.c);
  }

  function doGenerate() {
    const result = generateFormula(request);
    output = result.formula
      ? `${result.formula}\n\n${result.explanation}`
      : `${result.explanation}\n\nSuggerimento: scrivi per esempio "somma A1:A10" oppure "media dei valori maggiori di 5 in B1:B20".`;
  }

  function doExplain() {
    const result = explainFormula(engine, sheet.sel.r, sheet.sel.c);
    if (!result.ok) {
      output = result.message;
      return;
    }
    const lines = [
      `Formula in ${result.address}: ${result.formula}`,
      `Risultato: ${result.result}`,
      '',
      'Struttura:',
      ...result.steps.map((s, i) => `  ${i + 1}. ${s.text}`),
    ];
    if (result.error) {
      lines.push('', `Errore: ${result.error.code} — ${result.error.detail ?? ''}`);
    }
    output = lines.join('\n');
  }

  function doSuggest() {
    const suggestions = suggestForSelection(engine, sheet.sel.r, sheet.sel.c);
    if (!suggestions.length) {
      output = 'Nessun suggerimento disponibile per questa cella.';
      return;
    }
    output = suggestions
      .map((s) => `${s.formula}\n   ${s.reason}`)
      .join('\n\n');
  }

  function doRefactor() {
    const raw = engine.getRaw(sheet.sel.r, sheet.sel.c);
    const proposals = refactorFormula(raw);
    output = proposals.length
      ? proposals.map((p) => `${p.formula}\n   ${p.reason}`).join('\n\n')
      : 'Nessun refactoring suggerito per questa formula.';
  }

  function doAnalyze() {
    const report = analyzeSheet(engine);
    const lines = [
      `Celle con contenuto: ${report.filledCells}`,
      `Formule: ${report.formulaCount}`,
      `Errori: ${report.errors.length}`,
      `Riferimenti circolari: ${report.circular.length}`,
      '',
      'Funzioni usate:',
      ...(report.functions.length
        ? report.functions.map((f) => `  ${f.name} (${f.count})`)
        : ['  nessuna']),
    ];
    if (report.errors.length) {
      lines.push('', 'Errori rilevati:', ...report.errors.slice(0, 10).map((e) => `  ${e.address}: ${e.code} — ${e.detail ?? ''} (${e.formula})`));
    }
    if (report.circular.length) {
      lines.push('', 'Riferimenti circolari:', ...report.circular.slice(0, 10).map((e) => `  ${e.address}: ${e.detail}`));
    }
    output = lines.join('\n');
  }

  async function doOnline() {
    if (!onlinePrompt.trim()) {
      output = 'Scrivi una domanda da inviare al servizio.';
      return;
    }
    busy = true;
    const context =
      `Cella selezionata: ${currentAddress()}\n` +
      `Contenuto: ${engine.getRaw(sheet.sel.r, sheet.sel.c) || '(vuota)'}\n` +
      `Valore: ${engine.getDisplay(sheet.sel.r, sheet.sel.c)}`;
    const res = await callOnlineAI({
      endpoint,
      apiKey,
      model,
      prompt: onlinePrompt,
      context,
    });
    busy = false;
    output = res.ok ? res.text : `Errore: ${res.error}`;
  }

  function insertGenerated() {
    const first = output.trim().split('\n')[0];
    if (first.startsWith('=')) {
      sheet.startEdit(first);
      sheet.setStatus('Formula inserita nella cella: completare e confermare.', 'info');
    }
  }
</script>

<aside class="ai-panel" aria-label="Assistente AI">
  <header>
    <span>Assistente AI</span>
    <span class="spacer" style="flex:1"></span>
    <button onclick={() => sheet.setAiOpen(false)} title="Chiudi il pannello">✕</button>
  </header>

  <div class="ai-body">
    <div style="margin-bottom:0.5rem">
      <span
        class="ai-tab"
        class:active={sheet.aiTab === 'offline'}
        role="button"
        tabindex="0"
        onclick={() => sheet.setAiTab('offline')}
        onkeydown={(e) => e.key === 'Enter' && sheet.setAiTab('offline')}
      >
        Offline
      </span>
      <span
        class="ai-tab"
        class:active={sheet.aiTab === 'online'}
        role="button"
        tabindex="0"
        onclick={() => sheet.setAiTab('online')}
        onkeydown={(e) => e.key === 'Enter' && sheet.setAiTab('online')}
      >
        Online (opzionale)
      </span>
    </div>

    {#if sheet.aiTab === 'offline'}
      <p style="margin-top:0">
        <strong>Genera una formula</strong> — scrivi cosa ti serve in linguaggio naturale.
      </p>
      <textarea
        bind:value={request}
        placeholder="es. somma A1:A10&#10;es. conta i valori maggiori di 5 in B2:B20&#10;es. se A1 è maggiore di 10 allora 1 altrimenti 0"
        aria-label="Richiesta in linguaggio naturale"
      ></textarea>
      <div class="ai-actions">
        <button class="secondary" onclick={doGenerate}>Genera formula</button>
        <button class="secondary outline" onclick={doExplain}>Spiega {currentAddress()}</button>
        <button class="secondary outline" onclick={doSuggest}>Suggerisci</button>
        <button class="secondary outline" onclick={doRefactor}>Refactoring</button>
        <button class="secondary outline" onclick={doAnalyze}>Analizza foglio</button>
      </div>

      {#if output}
        <div class="ai-result">{output}</div>
        <div class="ai-actions" style="margin-top:0.5rem">
          <button class="secondary" onclick={insertGenerated}>Inserisci nella cella</button>
          <button class="secondary outline" onclick={() => (output = '')}>Pulisci</button>
        </div>
      {/if}

      <p class="ai-note">
        L'assistente offline analizza il foglio nel browser: nessun dato viene inviato a
        server esterni.
      </p>
    {:else}
      <p style="margin-top:0">
        <strong>Servizio AI opzionale</strong> — collega un endpoint compatibile con
        OpenAI (es. un gateway aziendale o un provider self-hosted).
      </p>
      <input
        type="url"
        bind:value={endpoint}
        placeholder="https://api.example.com/v1/chat/completions"
        aria-label="Endpoint"
      />
      <input type="password" bind:value={apiKey} placeholder="Chiave API" aria-label="Chiave API" />
      <input type="text" bind:value={model} placeholder="Modello (es. gpt-4o-mini)" aria-label="Modello" />
      <textarea bind:value={onlinePrompt} placeholder="Domanda per il servizio…" aria-label="Domanda"></textarea>
      <div class="ai-actions">
        <button class="secondary" onclick={doOnline} disabled={busy}>
          {busy ? 'Invio…' : 'Invia'}
        </button>
        <button class="secondary outline" onclick={saveSettings}>Salva configurazione</button>
      </div>

      {#if output}
        <div class="ai-result">{output}</div>
      {/if}

      <p class="ai-note">
        Attenzione: le impostazioni (inclusa la chiave) sono salvate solo nel
        <em>localStorage</em> di questo browser e le richieste partono solo quando premi
        "Invia". Il testo della cella selezionata viene allora trasmesso al servizio
        indicato: usa questa funzione solo con servizi di cui ti fidi.
      </p>
    {/if}
  </div>
</aside>
