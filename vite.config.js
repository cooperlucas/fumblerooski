import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built site works from any folder or host (Cloudflare Pages, Netlify, GitHub Pages).
export default defineConfig({ plugins: [react()], base: './' });
