import {defineConfig} from 'vite';

/**
 * 只服务一个用途：在浏览器里把人物转到目标角度，读数字。
 * 因此没什么可配的 —— 固定端口、只监听本机（浏览器就在这台机器上）。
 */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
  },
});
