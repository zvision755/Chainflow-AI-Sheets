import {serializeWorkspace,type Workspace} from './workspace';
import {validateTtsConfig,type TtsConfig} from './tts';
import {loadConnection,type Connection} from '../model/credentials';
export function localBackup(workspace:Workspace,connection:Connection,tts:TtsConfig){
  const safe=loadConnection({getItem:()=>JSON.stringify({...connection,remember:false})}).connection;
  return JSON.stringify({...JSON.parse(serializeWorkspace(workspace)),localSettings:{version:1,connection:safe,tts:validateTtsConfig(tts)}});
}
export function localBackupSettings(raw:unknown){const data=raw as {localSettings?:{version?:number;connection?:unknown;tts?:unknown}};if(!data?.localSettings)return null;if(data.localSettings.version!==1)throw Error('Local 配置备份版本不支持');const connection=loadConnection({getItem:()=>JSON.stringify({...data.localSettings!.connection as object,remember:false})}).connection;return {connection,tts:validateTtsConfig(data.localSettings.tts)};}
