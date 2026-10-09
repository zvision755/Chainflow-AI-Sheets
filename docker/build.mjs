import { createBuilder, build } from 'vite';
import { rm, copyFile } from 'node:fs/promises';
const out=process.env.CHAINFLOW_BUILD_DIR??'dist-docker';
if(!/^dist-[a-z-]+$/.test(out))throw Error('Build directory must be a project-local dist-* directory');
await rm(out,{recursive:true,force:true});
await (await createBuilder({configFile:'docker/vite.config.ts'})).buildApp();
// Bundle only the container entry, retaining runtime packages as dependencies.
const mode=process.env.CHAINFLOW_DEPLOYMENT??'server';
if(mode!=='server')throw Error('Invalid Docker deployment mode');
await build({configFile:false,build:{ssr:'docker/server.ts',outDir:out,emptyOutDir:false,rolldownOptions:{output:{entryFileNames:'runtime.mjs'}}}});
if(mode==='server')await copyFile('docker/personal-backup.mjs',out+'/personal-backup.mjs');
