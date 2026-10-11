'use client';
import {createContext,useContext,useRef,useLayoutEffect,useState,useMemo,Fragment,type ReactNode,type CSSProperties} from 'react';
import {useWindowVirtualizer} from '@tanstack/react-virtual';
import type {Row,Column} from '../core/types';
import {DESKTOP_COLUMN_WIDTH,DESKTOP_ROW_HEIGHT} from '../core/overview-layout';
type ScrollApi={element:HTMLDivElement|null};
const ScrollContext=createContext<ScrollApi>({element:null});
export function DesktopTableScroll({count,children}:{count:number;children:ReactNode}){
 const [element,setElement]=useState<HTMLDivElement|null>(null);
 const api=useMemo<ScrollApi>(()=>({element}),[element]);
 function jump(index:number){const body=element?.querySelector('tbody');if(body)window.scrollTo({top:Math.max(0,body.getBoundingClientRect().top+window.scrollY+index*DESKTOP_ROW_HEIGHT-(index===0?0:window.innerHeight-DESKTOP_ROW_HEIGHT)),behavior:'instant'});}
 return <ScrollContext.Provider value={api}><div ref={setElement} className="table-scroll desktop-table-scroll" style={{'--desktop-column-width':DESKTOP_COLUMN_WIDTH+'px'} as CSSProperties}>{children}</div>{count>50&&<nav className="desktop-row-navigation" aria-label="表格行导航"><button className="button" onClick={()=>jump(0)}>回到首行</button><button className="button" onClick={()=>jump(count-1)}>跳到末行</button></nav>}</ScrollContext.Provider>;
}
export function DesktopRows({rows,columns,children}:{rows:Row[];columns:Column[];children:(row:Row,index:number,measure:undefined)=>ReactNode}){
 const api=useContext(ScrollContext),body=useRef<HTMLTableSectionElement>(null);
 const [offset,setOffset]=useState(0);const enabled=rows.length>50;
 useLayoutEffect(()=>{if(!body.current)return;const measure=()=>setOffset(body.current!.getBoundingClientRect().top+window.scrollY);measure();const observer=new ResizeObserver(measure);observer.observe(api.element??body.current);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[api,enabled]);
 const virtual=useWindowVirtualizer({count:rows.length,enabled,getItemKey:index=>rows[index].id,estimateSize:()=>DESKTOP_ROW_HEIGHT,overscan:3,scrollMargin:offset});
 if(!enabled)return <tbody ref={body}>{rows.map((row,index)=>children(row,index,undefined))}</tbody>;
 const items=virtual.getVirtualItems(),end=items.length?items[items.length-1].end-offset:0;
 const spacer=(height:number,key:string)=>height>0?<tr key={key} aria-hidden="true" className="virtual-row-spacer"><td colSpan={columns.length+2} style={{height,padding:0,border:0}}/></tr>:null;
 return <tbody ref={body}>{items.map((item,index)=>{const start=item.start-offset,gap=start-(index?items[index-1].end-offset:0);return <Fragment key={item.key}>{spacer(gap,'before-'+item.key)}{children(rows[item.index],item.index,undefined)}</Fragment>;})}{spacer(virtual.getTotalSize()-end,'last')}</tbody>;
}
