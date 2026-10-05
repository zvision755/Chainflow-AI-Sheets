import { z } from 'zod';
import type { RunOptions } from './types';
export const RUN_SETTINGS_STORAGE='chainflow-run-settings-v1';
export const defaultRunOptions:RunOptions={mode:'api',concurrency:2,timeout:120000,maxSteps:50,maxRetries:1,totalTimeout:600000,dependencyDelayMs:500,autoRetry:true,apiMaxRetries:2,retryDelayMs:2000};
const schema=z.object({agentModel:z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/).optional(),mode:z.enum(['api','agent']),concurrency:z.number().int().min(1).max(3),timeout:z.number().int().min(1000).max(120000),maxSteps:z.number().int().min(1).max(3000),maxRetries:z.number().int().min(0).max(2),totalTimeout:z.number().int().min(1000).max(600000),dependencyDelayMs:z.number().min(0).max(60000),autoRetry:z.boolean(),apiMaxRetries:z.number().int().min(0).max(3),retryDelayMs:z.number().int().min(10).max(30000)});
export function readRunOptions(raw:string|null):RunOptions|null{try{return raw?schema.parse(JSON.parse(raw)):null;}catch{return null;}}
export function writeRunOptions(options:RunOptions){return JSON.stringify(schema.parse({...defaultRunOptions,...options}));}
