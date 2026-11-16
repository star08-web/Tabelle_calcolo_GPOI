/**
 * main.js — punto d'ingresso dell'applicazione.
 *
 * Si occupa di:
 *   - montare il componente Svelte;
 *   - ripristinare preferenze e foglio salvato nel browser;
 *   - registrare il service worker (con percorsi RELATIVI, requisito
 *     fondamentale per il funzionamento su GitHub Pages);
 *   - gestire il prompt di installazione della PWA e gli eventi online/offline.
 */

import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { sheet } from './lib/sheet.svelte.js';
import { loadSheet } from './lib/storage.js';

const target = document.getElementById('app');
export const app = mount(App, { target });

// Espone lo store per ispezione dalla console del browser (test e debug).
if (typeof window !== 'undefined') {
  window.miniSheet = sheet;
}

/* ---------------- stato iniziale ---------------- */

sheet.restorePrefs();

const saved = loadSheet();
if (saved) {
  sheet.engine.fromJSON(saved);
  sheet.setStatus('Foglio precedente ripristinato dal browser.', 'info');
} else {
  // Prima apertura: si carica un piccolo foglio di esempio per mostrare subito
  // il funzionamento del motore di calcolo.
  sheet.loadDemo();
}

/* ---------------- service worker ---------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // "./sw.js" e' un percorso RELATIVO: su GitHub Pages il file vive in
      // /<repo>/sw.js, non in /sw.js.
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      sheet.setSwReady(true);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            sheet.setStatus(
              'Una nuova versione e\' disponibile: ricarica la pagina per aggiornare.',
              'info'
            );
          }
        });
      });
    } catch (e) {
      console.warn('[pwa] registrazione del service worker fallita', e);
      sheet.setStatus('Service worker non registrato: offline non disponibile.', 'error');
    }
  });
}

/* ---------------- installazione PWA ---------------- */

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  sheet.setInstallEvent(event);
});

window.addEventListener('appinstalled', () => {
  sheet.setStatus('Applicazione installata con successo.', 'ok');
  sheet.dismissInstallBanner();
});

/* ---------------- rete ---------------- */

window.addEventListener('online', () => sheet.setOnline(true));
window.addEventListener('offline', () => sheet.setOnline(false));

/* ---------------- persistenza periodica ---------------- */

// Salva il foglio anche se la pagina viene chiusa senza attendere il debounce.
window.addEventListener('beforeunload', () => {
  try {
    localStorage.setItem('mini-sheet-pwa/v1', JSON.stringify(sheet.engine.toJSON()));
  } catch {
    /* ignorato */
  }
});
