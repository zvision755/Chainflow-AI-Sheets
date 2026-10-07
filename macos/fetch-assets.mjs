// Developer-only downloads. The installed apps never run this script.
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync('macos/runtime-manifest.json'));
const lite=process.argv.includes('--lite-only');
function digest(path,algorithm='sha256'){
 const data=readFileSync(path);
 if(algorithm==='git-sha1')return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
 return createHash(algorithm).update(data).digest('hex');
}
function download(url,path,hash,algorithm='sha256'){
 if(existsSync(path)&&digest(path,algorithm)===hash)return;
 mkdirSync(dirname(path),{recursive:true});
 execFileSync('curl',['--fail','--location','--retry','5','--retry-all-errors','--max-time','300',url,'-o',path+'.part'],{stdio:'inherit'});
 if(digest(path+'.part',algorithm)!==hash)throw Error(`Checksum mismatch: ${path}`);
 renameSync(path+'.part',path);
}
for(const arch of ['arm64','x64']){
 const file=`.cache/macos/node-${arch}.tar.gz`;
 download(`https://nodejs.org/dist/v${manifest.node.version}/node-v${manifest.node.version}-darwin-${arch}.tar.gz`,file,manifest.node[arch]);
 execFileSync('tar',['-xzf',file,'-C','.cache/macos']);
}
const codexTar='.cache/macos/codex-x64.tgz';
const integrity=manifest.codex.x64Integrity.split('-')[1];
download(`https://registry.npmjs.org/@openai/codex/-/codex-${manifest.codex.version}-darwin-x64.tgz`,codexTar,Buffer.from(integrity,'base64').toString('hex'),'sha512');
mkdirSync('.cache/macos/codex-x64',{recursive:true});execFileSync('tar',['-xzf',codexTar,'-C','.cache/macos/codex-x64']);
for(const [name,item]of Object.entries(manifest.licenses))download(item.url,`.cache/macos/licenses/${name}`,item.sha256);
if(!lite){
 const models=JSON.parse(readFileSync('macos/tts/model-manifest.json'));
 for(const item of models.files)download(`https://huggingface.co/${models.repository}/resolve/${models.revision??'main'}/${item.path}`,`macos/tts/models/${item.path}`,item.hash,item.algorithm);
}
console.log('Runtime and model assets verified.');
