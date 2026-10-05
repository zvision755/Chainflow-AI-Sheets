import { createBuilder, build } from 'vite';
import { rm } from 'node:fs/promises';
await rm('dist-docker',{recursive:true,force:true});
await (await createBuilder({configFile:'docker/vite.config.ts'})).buildApp();
// Bundle only the container entry, retaining runtime packages as dependencies.
await build({configFile:false,build:{ssr:'docker/server.ts',outDir:'dist-docker',emptyOutDir:false,rolldownOptions:{output:{entryFileNames:'runtime.mjs'}}}});
