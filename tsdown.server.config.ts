import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'server/server.ts',
  // Bundle everything EXCEPT Node.js built-ins and native addons
  external: [
    // Node built-ins
    'fs', 'path', 'os', 'http', 'https', 'net', 'stream', 'crypto',
    'url', 'util', 'events', 'buffer', 'child_process', 'cluster',
    'dns', 'domain', 'module', 'process', 'readline', 'repl',
    'string_decoder', 'timers', 'tls', 'tty', 'vm', 'worker_threads',
    'zlib', 'assert', 'perf_hooks', 'querystring', 'dgram', 'inspector',
    // AppKit loads these only when NODE_ENV=development.
    'vite', '@vitejs/plugin-react',
    // Native .node addons
    /\.node$/,
  ],
  // tsdown externalizes package.json dependencies by default.
  noExternal: /.*/,
  env: {
    NODE_ENV: 'production',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  treeshake: {
    moduleSideEffects: (id) =>
      !id.includes('@databricks/appkit/dist/plugins/server/vite-dev-server') &&
      !id.includes('@databricks/appkit/dist/plugins/server/react-source-loc-vite-plugin') &&
      !id.includes('@databricks/appkit/dist/type-generator'),
  },
  minify: true,
  tsconfig: 'tsconfig.server.json',
  outExtensions: () => ({
    js: '.js',
  }),
});
