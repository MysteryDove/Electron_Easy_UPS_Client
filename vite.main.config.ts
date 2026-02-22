import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
	build: {
		rollupOptions: {
			external: [
				/^@duckdb\/node-api(?:\/.*)?$/,
				/^@duckdb\/node-bindings(?:-[^/]+)?(?:\/.*)?$/,
				/\.node$/,
			],
		},
	},
});
