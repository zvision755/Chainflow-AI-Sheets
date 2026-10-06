// A developer build requires macOS + Command Line Tools. Users only open the app.
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {build} from 'vite';
const lite=process.argv.includes('--lite-only');
const run=(program,args)=>execFileSync(program,args,{stdio:'inherit'});
mkdirSync('.cache/macos',{recursive:true});
run(process.execPath,['macos/fetch-assets.mjs',...(lite?['--lite-only']:[])]);
await import('../docker/build.mjs');
await build({configFile:false,build:{ssr:'macos/server.ts',outDir:'dist-docker',emptyOutDir:false,rolldownOptions:{output:{entryFileNames:'desktop.mjs'}}}});
for(const arch of ['arm64','x64'])run('xcrun',['swiftc','-O','-target',`${arch==='x64'?'x86_64':arch}-apple-macosx14.0`,'macos/App.swift','-o',`.cache/macos/ChainFlow-${arch}`]);
run('lipo',['-create','.cache/macos/ChainFlow-arm64','.cache/macos/ChainFlow-x64','-output','.cache/macos/ChainFlow-universal']);
run('xcrun',['swiftc','macos/Icon.swift','-o','.cache/macos/icon-maker']);
mkdirSync('.cache/macos/AppIcon.iconset',{recursive:true});run('.cache/macos/icon-maker',['.cache/macos/icon.png']);
for(const size of [16,32,128,256,512]){
 run('sips',['-z',String(size),String(size),'.cache/macos/icon.png','--out',`.cache/macos/AppIcon.iconset/icon_${size}x${size}.png`]);
 run('sips',['-z',String(size*2),String(size*2),'.cache/macos/icon.png','--out',`.cache/macos/AppIcon.iconset/icon_${size}x${size}@2x.png`]);
}
run('iconutil',['-c','icns','.cache/macos/AppIcon.iconset','-o','.cache/macos/AppIcon.icns']);
if(!lite){
 if(process.arch!=='arm64')throw Error('Full MLX must be built on Apple Silicon');
 // uv is build tooling; Python and all project packages remain in this .venv.
 process.env.MACOSX_DEPLOYMENT_TARGET='14.0';
 run('uv',['sync','--project','macos/tts','--python','3.12','--locked','--python-platform','aarch64-apple-darwin']);
 run('macos/tts/.venv/bin/python',['-m','PyInstaller','--noconfirm','--distpath','.cache/macos/python-dist','--workpath','.cache/macos/python-build','macos/tts/kokoro.spec']);
 run(process.execPath,['macos/package.mjs','--full']);
}
run(process.execPath,['macos/package.mjs']);
