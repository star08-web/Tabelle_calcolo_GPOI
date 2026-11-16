<!--
  App.svelte — composizione dell'applicazione.
-->
<script>
  import Ribbon from './components/Ribbon.svelte';
  import FormulaBar from './components/FormulaBar.svelte';
  import SheetGrid from './components/SheetGrid.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import AiPanel from './components/AiPanel.svelte';
  import HelpModal from './components/HelpModal.svelte';
  import Icon from './components/Icon.svelte';
  import { sheet } from './lib/sheet.svelte.js';

  /**
   * Scorciatoie globali: funzionano indipendentemente dal focus
   * (griglia, ribbon, barra delle formule, pannello AI).
   */
  function onGlobalKeydown(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const target = event.target;
    const isTextField =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    switch (key) {
      case 'z':
        event.preventDefault();
        if (event.shiftKey) sheet.redo();
        else sheet.undo();
        break;
      case 'y':
        event.preventDefault();
        sheet.redo();
        break;
      case 's':
        event.preventDefault();
        sheet.saveLocal();
        break;
      case 'c':
        if (isTextField) return; // lascia il copia nativa del browser
        event.preventDefault();
        sheet.copyCell();
        break;
      case 'x':
        if (isTextField) return;
        event.preventDefault();
        sheet.cutCell();
        break;
      case 'v':
        if (isTextField) return;
        event.preventDefault();
        sheet.pasteCell();
        break;
      default:
        break;
    }
  }

  async function installApp() {
    const event = sheet.installEvent;
    if (!event) return;
    event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === 'accepted') {
      sheet.setStatus('Applicazione installata.', 'ok');
    }
    sheet.setInstallEvent(null);
    sheet.dismissInstallBanner();
  }
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="app-shell">
  <header class="titlebar">
    <div class="brand">
      <Icon name="grid" size={20} />
      <span>Mini-Foglio di Calcolo<span class="full"> — PWA</span></span>
    </div>
    <span class="pill" class:offline={!sheet.online}>
      {sheet.online ? 'Online' : 'Offline'}
    </span>
    <span class="pill" title="Il service worker e' attivo: l'app funziona senza rete">
      {sheet.swReady ? 'Pronto offline' : 'Cache in corso…'}
    </span>
    <span class="spacer"></span>
    <button class="icon-btn" onclick={() => sheet.setAiOpen(!sheet.aiOpen)} title="Assistente AI">
      <Icon name="ai" size={14} /> AI
    </button>
    <button class="icon-btn" onclick={() => sheet.setHelpOpen(true)} title="Guida">Guida</button>
    <button class="icon-btn" onclick={() => sheet.toggleTheme()} title="Cambia tema">
      <Icon name="theme" size={14} />
    </button>
  </header>

  {#if sheet.showInstallBanner}
    <div class="install-banner">
      <span>Vuoi installare l'app sul dispositivo? Funziona offline e si avvia come una normale app.</span>
      <span class="spacer" style="flex:1"></span>
      <button onclick={installApp}>Installa</button>
      <button class="secondary outline" onclick={() => sheet.dismissInstallBanner()}>Non ora</button>
    </div>
  {/if}

  <Ribbon />
  <FormulaBar />

  <div class="grid-area">
    <SheetGrid />
    {#if sheet.aiOpen}
      <AiPanel />
    {/if}
  </div>

  <StatusBar />
  <HelpModal />
</div>
