'use client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {memo} from 'react';
import {cellText} from '../core/markdown';
import type {Column} from '../core/types';
export const MarkdownContent=memo(function MarkdownContent({text}:{text:string}) {
  return <div className="markdown-content"><Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url=>/^(https?:\/\/|mailto:|#)/i.test(url)?url:''} components={{
    a:({children,href})=><a href={href||undefined} target="_blank" rel="noopener noreferrer">{children}</a>,
    img:({alt})=><span>{alt}</span>,
    table:({children})=><div className="markdown-table-scroll"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
});
export function DesktopCellPreview({column,label,value,onOpen}:{column:Column;label:string;value:string;onOpen:()=>void}) {
 return <button className="desktop-cell" aria-label={`查看${label}`} title="查看完整内容 / 编辑" onClick={onOpen}><span className={'desktop-cell-preview'+(!value?' placeholder':'')}>{cellText(column,value).slice(0,1200)||'点击填写内容'}</span></button>;
}
