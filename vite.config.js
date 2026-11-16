import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Configurazione Vite del progetto.
 *
 * `base: './'` e' fondamentale: le risorse devono essere referenziate con
 * percorsi relativi perche' l'applicazione funzioni sia in locale, sia su
 * GitHub Pages (sottopercorso /<repo>/) sia su Vercel (radice del dominio).
 */
export default defineConfig({
  base: './',
  plugins: [svelte(), swPrecachePlugin()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // math.js e day.js in chunk separati: il core dell'applicazione
          // resta leggero e viene caricato per primo.
          if (id.includes('node_modules/mathjs')) return 'vendor-math';
          if (id.includes('node_modules/dayjs')) return 'vendor-dayjs';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});

/**
 * Plugin che genera il service worker con l'elenco dei file da mettere in
 * cache (precache) al momento del build.
 *
 * Il placeholder `__PRECACHE_MANIFEST__` presente in `public/sw.js` viene
 * sostituito con la lista reale dei file prodotti da Vite: in questo modo
 * l'applicazione funziona offline anche per i bundle con nome hashato.
 */
function swPrecachePlugin() {
  return {
    name: 'sw-precache-manifest',
    apply: 'build',
    async closeBundle() {
      const { readFileSync, writeFileSync, existsSync, readdirSync, statSync } = await import('node:fs');
      const { join, relative, sep } = await import('node:path');
      const { createHash } = await import('node:crypto');
      const root = process.cwd();
      const swPath = join(distDir, 'sw.js');
      if (!existsSync(swPath)) return;

      const files = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const st = statSync(full);
          if (st.isDirectory()) walk(full);
          else {
            const rel = './' + relative(distDir, full).split(sep).join('/');
            if (rel !== './sw.js') files.push(rel);
          }
        }
      };
      walk(distDir);

      const manifest = files.sort();
      const source = readFileSync(swPath, 'utf8');
      const version = createHash('sha256').update(manifest.join('|')).digest('hex').slice(0, 12);
      // Il placeholder e' racchiuso in una stringa JS: al build time al suo
      // posto viene scritto il testo JSON dell'elenco, cosi' nel service
      // worker la riga diventa  JSON.parse('["...","..."]')  -> un array.
      let out = source.replace('__PRECACHE_MANIFEST__', JSON.stringify(manifest));
      // Ogni build produce una cache nuova: le cache precedenti vengono
      // eliminate dall'evento "activate".
      out = out.replace('__CACHE_VERSION__', version);
      writeFileSync(swPath, out, 'utf8');
      this.info?.(`service worker: ${manifest.length} risorse in precache (cache ${version})`);
    },
  };
}
