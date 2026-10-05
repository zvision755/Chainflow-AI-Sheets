import type { Column, Generate, GenerateResult } from '../core/types';
export async function runApi(column:Column,input:string,generate:Generate,signal:AbortSignal):Promise<GenerateResult>{
  return generate({model:column.model,prompt:column.prompt,input,maxTokens:column.maxTokens,reasoning:column.reasoning},signal);
}
