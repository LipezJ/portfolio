// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
  integrations: [icon()],

  // Accesible desde la red local: útil para probar en el móvil. Solo afecta
  // a dev y preview, la salida es estática.
  server: { host: true },

  vite: {
    plugins: [tailwindcss()]
  }
});
