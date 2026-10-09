'use client';
import {useState} from 'react';
export function RunNumberInput({label,value,min,max,disabled,onCommit}:{label:string;value:number;min:number;max:number;disabled:boolean;onCommit:(value:number)=>void}){
  const [previous,setPrevious]=useState(value);
  const [text,setText]=useState(String(value));
  if(previous!==value){setPrevious(value);setText(String(value));}
  function commit(){const next=Number(text);if(!text.trim()||!Number.isFinite(next)){setText(String(value));return;}const bounded=Math.max(min,Math.min(max,Math.round(next)));setText(String(bounded));if(bounded!==value)onCommit(bounded);}
  return <input aria-label={label} type="number" inputMode="numeric" min={min} max={max} step={1} value={text} disabled={disabled} onChange={event=>setText(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>;
}
