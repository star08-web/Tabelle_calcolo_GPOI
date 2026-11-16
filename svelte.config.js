import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte 5 in modal mode: i warning legacy non bloccano.
    runes: true,
  },
};
