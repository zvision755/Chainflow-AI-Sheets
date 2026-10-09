'use client';
import {useMemo,useState} from 'react';
import type {TextSplitOptions} from '../core/text-segmenter';
const presets={'中文 / 日文':'。！？!?；;…',英文:'.!?;:','中日英混合':'。！？!?；;….:'};
export type SplitSettings={rule:keyof typeof presets|'custom';custom:string;splitLines:boolean;keepDelimiter:boolean};
export function useTextSplitSettings(){
  const [settings,setSettings]=useState<SplitSettings>({rule:'中日英混合',custom:'。！？!?；;….:',splitLines:true,keepDelimiter:true});
  const options=useMemo<TextSplitOptions>(()=>({delimiters:settings.rule==='custom'?settings.custom:presets[settings.rule],splitLines:settings.splitLines,keepDelimiter:settings.keepDelimiter}),[settings]);
  return {settings,setSettings,options};
}
export function TextSplitControls({settings,onChange}:{settings:SplitSettings;onChange:(settings:SplitSettings)=>void}){
  const delimiters=settings.rule==='custom'?settings.custom:presets[settings.rule];
  return <><div className="splitter-options"><label>标点规则<select aria-label="标点规则" value={settings.rule} onChange={event=>onChange({...settings,rule:event.target.value as SplitSettings['rule']})}>{Object.keys(presets).map(name=><option key={name} value={name}>{name}</option>)}<option value="custom">自定义</option></select></label><label className="splitter-delimiters">切分符号<input aria-label="自定义切分符号" value={delimiters} onChange={event=>onChange({...settings,rule:'custom',custom:event.target.value})} placeholder="例如 。！？!?"/></label></div><div className="splitter-checks"><label className="import-check"><input type="checkbox" checked={settings.splitLines} onChange={event=>onChange({...settings,splitLines:event.target.checked})}/>换行处也切分</label><label className="import-check"><input type="checkbox" checked={settings.keepDelimiter} onChange={event=>onChange({...settings,keepDelimiter:event.target.checked})}/>保留句末标点</label></div></>;
}
