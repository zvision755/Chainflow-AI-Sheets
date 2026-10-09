import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {resolve} from 'node:path';
export default defineConfig({root:resolve('static'),base:process.env.CHAINFLOW_PAGES_BASE??'/Chainflow-AI-Sheets/',publicDir:resolve('public'),envDir:false,define:{__CHAINFLOW_DEPLOYMENT__:JSON.stringify('local-static')},plugins:[react()],css:{postcss:{plugins:[tailwind()]}},build:{outDir:resolve('dist-static'),emptyOutDir:true,sourcemap:false},server:{host:'127.0.0.1'},preview:{host:'127.0.0.1',port:3005,strictPort:true}});
