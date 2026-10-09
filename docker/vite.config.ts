import { defineConfig } from 'vite';
import vinext from 'vinext';
// Independent Node build. Never register Mac preview or Sites Worker plugins.
const out=process.env.CHAINFLOW_BUILD_DIR??'dist-docker';
export default defineConfig({define:{__CHAINFLOW_DEPLOYMENT__:JSON.stringify(process.env.CHAINFLOW_DEPLOYMENT??'server')},environments:{client:{build:{outDir:out+'/client'}}},plugins:[vinext({rscOutDir:out+'/server',ssrOutDir:out+'/server/ssr',clientOutDir:out+'/client'})]});
