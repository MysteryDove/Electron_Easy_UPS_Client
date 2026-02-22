import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    commonjsOptions: {
      exclude: [
        /node_modules[\\/]+@duckdb[\\/]node-api/,
        /node_modules[\\/]+@duckdb[\\/]node-bindings/,
      ],
    },
    rollupOptions: {
      external: [
        /^@duckdb\/node-api(?:\/.*)?$/,
        /^@duckdb\/node-bindings(?:-[^/]+)?(?:\/.*)?$/,
        /\.node$/,
      ],
    },
  },
});
