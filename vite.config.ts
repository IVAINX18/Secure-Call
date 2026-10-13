import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: 'all',
    headers: {
      'Permissions-Policy': 'camera=*, microphone=*, display-capture=*',
      'Feature-Policy': 'camera *; microphone *; display-capture *',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: wss: https:; media-src 'self' blob: data: https: mediastream:; connect-src 'self' wss: https: ws: http://localhost:8800; frame-src 'self' https:; worker-src 'self' blob:;",
    }
  },
  preview: {
    port: 4173,
    headers: {
      'Permissions-Policy': 'camera=*, microphone=*, display-capture=*',
      'Feature-Policy': 'camera *; microphone *; display-capture *',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: wss: https:; media-src 'self' blob: data: https: mediastream:; connect-src 'self' wss: https: ws: http://localhost:8800; frame-src 'self' https:; worker-src 'self' blob:;",
    }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        }
      }
    }
  }
});