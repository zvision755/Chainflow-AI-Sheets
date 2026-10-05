export type Status = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'stale';
export type Cell = { value: string; status: Status; revision: number; error?: string; elapsed?: number; usage?: Usage; completedAt?: number };
export type Usage = { input: number; output: number };
import type { TtsLanguage } from './tts';
export type Column = { id: string; name: string; sources: string[]; prompt: string; userPrompt?: string; model: string; maxTokens: number; reasoning: 'none'|'low'|'medium'|'high'; check: boolean; minLength: number; containsSource: boolean; ttsLanguage?: TtsLanguage; width?: number; freshResults?: boolean };
export const MIN_COLUMN_WIDTH = 180;
export const MAX_COLUMN_WIDTH = 1200;
export const defaultColumnWidth = (index: number) => [180, 260, 520, 300][index] ?? 330;
export const columnWidth = (column: Column, index: number) => column.width ?? defaultColumnWidth(index);
export type Row = { id: string; cells: Record<string, Cell> };
export type Sheet = { version: 1; name: string; columns: Column[]; rows: Row[] };
export type GenerateInput = { model: string; prompt: string; input: string; maxTokens: number; reasoning: Column['reasoning'] };
export type GenerateResult = { text: string; usage: Usage };
export type GenerateContext={mode:'api'|'agent';agentBackend?:'api'|'codex'};
export type Generate = (input: GenerateInput, signal: AbortSignal, context?:GenerateContext) => Promise<GenerateResult>;
export type Step = { model?:string; backend?:'api'|'codex'; id: string; row: string; column: string; phase: string; state: 'running'|'done'|'error'|'cancelled'; started: number; elapsed?: number; error?: string; usage?: Usage };
export type RunOptions = { agentModel?:string; mode: 'api'|'agent'; agentBackend?:'api'|'codex'; concurrency: number; timeout: number; maxSteps: number; maxRetries: number; totalTimeout: number; dependencyDelayMs?: number; autoRetry?: boolean; apiMaxRetries?: number; retryDelayMs?: number };
export const labels: Record<Status,string> = {idle:'待运行',queued:'排队',running:'生成中',done:'完成',error:'失败',cancelled:'已取消',stale:'需要更新'};
export const emptyCell = (value = '', status: Status = 'idle'): Cell => ({value,status,revision:0});
export const newColumn = (id: string, name: string, sources: string[]): Column => ({id,name,sources,prompt:'',userPrompt:'{{text}}',model:'gpt-6-luna',maxTokens:1024,reasoning:'none',check:false,minLength:1,containsSource:false,ttsLanguage:'off'});
export const id = () => crypto.randomUUID();
export function example(): Sheet {
  const input = newColumn('input','日语单词',[]);
  const explain = {...newColumn('explain','日语释义',['input']),prompt:'用日语解释这日语单词，输出必须要用到原单词',containsSource:true};
  const teacher = {...newColumn('teacher','老师解读',['explain']),prompt:'作为日语老师简短解释这个句子'};
  return {version:1,name:'日语词汇学习',columns:[input,explain,teacher],rows:[{id:'row-1',cells:{input:emptyCell('フレーム','done'),explain:emptyCell(),teacher:emptyCell()}}]};
}
