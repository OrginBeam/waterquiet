import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，保证部署到子路径（如 user.github.io/仓库名/）也能正确加载资源
  base: './',
  plugins: [],
  server: {
    port: 5173,
  },
});
