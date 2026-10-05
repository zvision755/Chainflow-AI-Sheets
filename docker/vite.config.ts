import { defineConfig } from 'vite';
import vinext from 'vinext';
// Independent Node build. Never register Mac preview or Sites Worker plugins.
export default defineConfig({environments:{client:{build:{outDir:'dist-docker/client'}}},plugins:[vinext({rscOutDir:'dist-docker/server',ssrOutDir:'dist-docker/server/ssr',clientOutDir:'dist-docker/client'})]});
