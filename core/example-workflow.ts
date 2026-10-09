import { parseSheet } from './storage';
import type { RunOptions } from './types';
import saved from './example-workflow.json';
// User-approved browser snapshot. No connection settings or credentials.
export function savedExample(){return parseSheet(structuredClone(saved));}
export function savedExampleOptions():RunOptions{return {streaming:true,mode:'api',concurrency:3,timeout:120000,maxSteps:50,maxRetries:1,totalTimeout:600000,dependencyDelayMs:1000,autoRetry:true,apiMaxRetries:3,retryDelayMs:2000};}
