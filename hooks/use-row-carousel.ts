'use client';
import {useCallback, useLayoutEffect, useRef, useState, type PointerEvent} from 'react';
import {flushSync} from 'react-dom';

type Options={enabled:boolean;rowId:string|null;previousId?:string;nextId?:string;onNavigate:(id:string)=>void};
type Drag={id:number;x:number;y:number;offset:number;horizontal:boolean;samples:{x:number;t:number}[]};
const excluded='button,a,input,textarea,select,summary,[contenteditable],[role="slider"],[data-no-row-swipe],pre,code,.markdown-table-scroll,.row-detail-card.editing';

// Only the transform changes during pointermove. React renders at gesture start,
// settling and navigation, never for every pixel of movement.
export function useRowCarousel(options:Options){
  const latest=useRef(options);
  useLayoutEffect(()=>{latest.current=options;});
  const viewport=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null);
  const viewportRef=useCallback((node:HTMLDivElement|null)=>{viewport.current=node;},[]);
  const trackRef=useCallback((node:HTMLDivElement|null)=>{track.current=node;},[]);
  const drag=useRef<Drag|null>(null),settling=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const frames=useRef<number[]>([]),complete=useRef<(()=>void)|null>(null);
  const [neighbors,setNeighbors]=useState(false),[busy,setBusy]=useState(false);
  const identity=JSON.stringify([options.enabled,options.rowId,options.previousId,options.nextId]);
  const [activeIdentity,setActiveIdentity]=useState(identity);
  if(activeIdentity!==identity){setActiveIdentity(identity);setNeighbors(false);setBusy(false);}
  function position(offset:number,animate=false){
    if(!track.current)return;
    track.current.style.transition=animate?'transform 260ms cubic-bezier(.22,.8,.2,1)':'none';
    track.current.style.transform=`translate3d(calc(-100% + ${offset}px),0,0)`;
  }
  function reset(){
    clearTimeout(timer.current);frames.current.forEach(cancelAnimationFrame);frames.current=[];
    drag.current=null;settling.current=false;complete.current=null;
    position(0);setNeighbors(false);setBusy(false);
  }
  useLayoutEffect(()=>{
    clearTimeout(timer.current);frames.current.forEach(cancelAnimationFrame);frames.current=[];
    drag.current=null;settling.current=false;complete.current=null;
    if(track.current){track.current.style.transition='none';track.current.style.transform='translate3d(-100%,0,0)';}
  },[identity]); // stable IDs invalidate a stale gesture before paint
  useLayoutEffect(()=>()=>{clearTimeout(timer.current);frames.current.forEach(cancelAnimationFrame);},[]);
  function settle(delta:number){
    const config=latest.current,width=viewport.current?.clientWidth??0;
    const target=delta>0?config.nextId:delta<0?config.previousId:undefined;
    const source=config.rowId;
    if(delta&&!target){delta=0;}
    settling.current=true;setBusy(true);
    complete.current=()=>{
      const current=latest.current;
      const stillAdjacent=source===current.rowId&&target===(delta>0?current.nextId:current.previousId);
      if(delta&&target&&stillAdjacent){
        // Commit the target content before the layout effect recenters the track.
        // Resetting the transform first briefly exposes the old center page.
        flushSync(()=>current.onNavigate(target));
        if(latest.current.rowId===source)reset();
      }else reset();
    };
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){complete.current();return;}
    position(-delta*width,true);
    timer.current=setTimeout(()=>complete.current?.(),310);
  }
  function navigate(delta:number){
    const config=latest.current,target=delta>0?config.nextId:config.previousId;
    if(!target||settling.current||drag.current)return;
    if(!config.enabled){config.onNavigate(target);return;}
    setNeighbors(true);
    // Give React and the browser one frame to lay out the neighboring page.
    settling.current=true;setBusy(true);
    frames.current.push(requestAnimationFrame(()=>{
      frames.current.push(requestAnimationFrame(()=>settle(delta)));
    }));
  }
  function onPointerDown(event:PointerEvent<HTMLDivElement>){
    if(drag.current){reset();return;}
    if(!latest.current.enabled||!latest.current.rowId||settling.current||!event.isPrimary||event.pointerType==='mouse')return;
    const target=event.target as HTMLElement;
    if(target.closest(excluded)||window.getSelection()?.isCollapsed===false)return;
    // Opt out of nested horizontal scrollers rather than stealing their gesture.
    for(let node:HTMLElement|null=target;node&&node!==event.currentTarget;node=node.parentElement){
      const overflow=getComputedStyle(node).overflowX;
      if(node.scrollWidth>node.clientWidth+2&&['auto','scroll'].includes(overflow))return;
    }
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,offset:0,horizontal:false,samples:[{x:event.clientX,t:event.timeStamp}]};
    setNeighbors(true);
  }
  function onPointerMove(event:PointerEvent<HTMLDivElement>){
    const current=drag.current;if(!current||current.id!==event.pointerId)return;
    const dx=event.clientX-current.x,dy=event.clientY-current.y;
    if(!current.horizontal){
      if(Math.abs(dy)>8&&Math.abs(dy)>=Math.abs(dx)){reset();return;}
      if(Math.abs(dx)<10||Math.abs(dx)<Math.abs(dy)*1.35)return;
      if(window.getSelection()?.isCollapsed===false){reset();return;}
      current.horizontal=true;
      try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* synthetic tests or interrupted touch */}
    }
    event.preventDefault();
    const config=latest.current,blocked=dx>0?!config.previousId:!config.nextId;
    const width=event.currentTarget.clientWidth;
    current.offset=blocked?Math.sign(dx)*Math.min(width*.13,Math.abs(dx)*.25):Math.max(-width,Math.min(width,dx));
    current.samples.push({x:event.clientX,t:event.timeStamp});
    current.samples=current.samples.filter(sample=>event.timeStamp-sample.t<=100).slice(-8);
    position(current.offset);
  }
  function onPointerUp(event:PointerEvent<HTMLDivElement>){
    const current=drag.current;if(!current||current.id!==event.pointerId)return;
    drag.current=null;
    if(!current.horizontal){setNeighbors(false);return;}
    const first=current.samples[0],last=current.samples.at(-1)!;
    const velocity=event.timeStamp-last.t>100?0:(last.x-first.x)/Math.max(1,last.t-first.t);
    const offset=current.offset,width=event.currentTarget.clientWidth;
    const enough=Math.abs(offset)>=width*.23||(Math.abs(offset)>=24&&Math.abs(velocity)>.45&&offset*velocity>0);
    settle(enough?(offset<0?1:-1):0);
  }
  function onPointerCancel(){if(drag.current?.horizontal){drag.current=null;settle(0);}else reset();}
  return {viewportRef,trackRef,neighbors,busy,navigate,handlers:{onPointerDown,onPointerMove,onPointerUp,onPointerCancel,onTransitionEnd:(event:React.TransitionEvent<HTMLDivElement>)=>{if(event.target===track.current&&event.propertyName==='transform')complete.current?.();}}};
}
