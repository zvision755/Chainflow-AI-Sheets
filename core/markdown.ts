import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {Column} from './types';
const parser=unified().use(remarkParse).use(remarkGfm);
type TextNode={type:string;value?:string;alt?:string;identifier?:string;children?:TextNode[]};
function plain(node:TextNode):string {
  if(node.type==='html'||node.type==='definition'||node.type==='thematicBreak')return '';
  if(node.type==='text'||node.type==='inlineCode'||node.type==='code')return node.value??'';
  if(node.type==='image'||node.type==='imageReference')return node.alt??'';
  if(node.type==='break')return '\n';
  if(node.type==='footnoteReference')return '';
  const children=node.children??[];
  const separator=['root','blockquote','list','listItem','footnoteDefinition','table'].includes(node.type)?'\n':node.type==='tableRow'?'\t':'';
  return children.map(plain).join(separator);
}
// Bounded shared cache avoids reparsing unchanged rows on every streaming update.
const textCache=new Map<string,string>();let cacheCharacters=0;
export function markdownToText(value:string):string {
  const cached=textCache.get(value);if(cached!==undefined)return cached;
  const result=plain(parser.parse(value) as TextNode).trim();
  textCache.set(value,result);cacheCharacters+=value.length+result.length;
  while(textCache.size>5000||cacheCharacters>4000000){
    const oldest=textCache.keys().next().value!;
    cacheCharacters-=oldest.length+textCache.get(oldest)!.length;textCache.delete(oldest);
  }
  return result;
}
export function cellText(column:Column,value:string):string {
  return column.displayMode==='markdown'?markdownToText(value):value;
}
