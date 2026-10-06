// Developer-only packager. Shipping apps never invoke npm, uv or a terminal.
import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,chmodSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const full=process.argv.includes('--full');const edition=full?'Full':'Lite';const root=process.cwd();
const stage=resolve('macos/staging',edition);rmSync(stage,{recursive:true,force:true});mkdirSync(stage,{recursive:true});
const app=join(stage,`ChainFlow AI Sheets ${edition}.app`),contents=join(app,'Contents'),resources=join(contents,'Resources');mkdirSync(join(contents,'MacOS'),{recursive:true});mkdirSync(resources,{recursive:true});
cpSync('.cache/macos/ChainFlow-'+(full?'arm64':'universal'),join(contents,'MacOS','ChainFlow'));chmodSync(join(contents,'MacOS','ChainFlow'),0o755);
cpSync('dist-docker',join(resources,'dist-docker'),{recursive:true});writeFileSync(join(resources,'package.json'),JSON.stringify({name:'chainflow-desktop',version:'0.2.0',type:'module'}));
// Explicit package allowlist; never copy the developer tree, test text or credentials.
const packages=['vinext','react','react-dom','react-server-dom-webpack','scheduler','undici','zod'];
for(const name of packages)cpSync(join('node_modules',name),join(resources,'node_modules',name),{recursive:true,dereference:true});
const manifest=JSON.parse(readFileSync('macos/runtime-manifest.json','utf8'));
for(const arch of full?['arm64']:['arm64','x64']){
 const tar=readFileSync(`.cache/macos/node-${arch}.tar.gz`);if(createHash('sha256').update(tar).digest('hex')!==manifest.node[arch])throw Error('Node SHA mismatch');
 cpSync(`.cache/macos/node-v${manifest.node.version}-darwin-${arch}/bin/node`,join(resources,'node-'+arch));chmodSync(join(resources,'node-'+arch),0o755);
 const codex=arch==='arm64'?'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex':'.cache/macos/codex-x64/package/vendor/x86_64-apple-darwin/bin/codex';
 cpSync(codex,join(resources,'codex-'+arch));chmodSync(join(resources,'codex-'+arch),0o755);
}
if(full){
 const models=JSON.parse(readFileSync('macos/tts/model-manifest.json'));
 for(const item of models.files){const data=readFileSync(join('macos/tts/models',item.path));const sum=item.algorithm==='git-sha1'?createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'):createHash('sha256').update(data).digest('hex');if(sum!==item.hash)throw Error('Model checksum mismatch');}
 cpSync('.cache/macos/python-dist/kokoro-mlx',join(resources,'kokoro'),{recursive:true,verbatimSymlinks:true});cpSync('macos/tts/models',join(resources,'models'),{recursive:true});
}
cpSync('macos/INSTALL.md',join(stage,'安装说明.md'));cpSync('macos/THIRD-PARTY.md',join(resources,'THIRD-PARTY.md'));
cpSync('.cache/macos/node-v24.21.0-darwin-arm64/LICENSE',join(resources,'Node-LICENSE'));
mkdirSync(join(resources,'licenses'),{recursive:true});
for(const name of Object.keys(manifest.licenses)){
 if(!full&&name.startsWith('espeak'))continue;
 if(!full&&name.startsWith('phonemizer'))continue;
 const source=join('.cache/macos/licenses',name);if(createHash('sha256').update(readFileSync(source)).digest('hex')!==manifest.licenses[name].sha256)throw Error('License source checksum mismatch');
 cpSync(source,join(resources,'licenses',name));
}
for(const name of ['lucide-react','tailwindcss','@tailwindcss/postcss','tw-animate-css']){
 for(const license of ['LICENSE','LICENSE.txt','LICENSE.md'])if(existsSync(join('node_modules',name,license)))cpSync(join('node_modules',name,license),join(resources,'licenses',name.replaceAll('/','-')+'-'+license));
}
if(existsSync('.cache/macos/AppIcon.icns'))cpSync('.cache/macos/AppIcon.icns',join(resources,'AppIcon.icns'));
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>ChainFlow</string><key>CFBundleIdentifier</key><string>ai.chainflow.sheets.${edition.toLowerCase()}</string><key>CFBundleName</key><string>ChainFlow AI Sheets ${edition}</string><key>CFBundleDisplayName</key><string>ChainFlow AI Sheets ${edition}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.2.0</string><key>CFBundleVersion</key><string>2</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>CFBundleIconFile</key><string>AppIcon</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`;
writeFileSync(join(contents,'Info.plist'),plist);
execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
symlinkSync('/Applications',join(stage,'Applications'));
mkdirSync('macos/release',{recursive:true});const dmg=resolve('macos/release',`ChainFlow-AI-Sheets-0.2.0-${full?'Full-MLX-arm64':'Lite-universal'}.dmg`);rmSync(dmg,{force:true});
execFileSync('hdiutil',['create','-volname',`ChainFlow ${edition}`,'-srcfolder',stage,'-format','UDZO','-ov',dmg],{stdio:'inherit'});
console.log('Built',dmg);
