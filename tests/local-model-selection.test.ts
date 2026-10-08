import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidLocalModels, localTextModels, reconcileLocalColumnModels } from '../core/local-model-selection';

test('local model choices exclude embedding and reranking endpoints',()=>{
  const models=['qwen3.6-35b-a3b','text-embedding-nomic-embed-text-v1.5','bge-reranker-v2'];
  assert.deepEqual(localTextModels(models),['qwen3.6-35b-a3b']);
});

test('local model mismatch detects stale cloud and non-generation model IDs',()=>{
  const available=['qwen3.6-35b-a3b','text-embedding-nomic-embed-text-v1.5'];
  assert.deepEqual(invalidLocalModels(['gpt-6-luna','qwen3.6-35b-a3b','text-embedding-nomic-embed-text-v1.5'],available),['gpt-6-luna','text-embedding-nomic-embed-text-v1.5']);
});

test('loading local models replaces stale cloud IDs while preserving valid local choices',()=>{
  const columns=[{id:'b',model:'gpt-6-luna'},{id:'c',model:'qwen3.6-35b-a3b'}];
  assert.deepEqual(reconcileLocalColumnModels(columns,['qwen3.6-35b-a3b','text-embedding-nomic-embed-text-v1.5']),[
    {id:'b',model:'qwen3.6-35b-a3b'},
    {id:'c',model:'qwen3.6-35b-a3b'},
  ]);
});

test('local model reconciliation does not choose an embedding-only service',()=>{
  const columns=[{id:'b',model:'gpt-6-luna'}];
  assert.deepEqual(reconcileLocalColumnModels(columns,['text-embedding-nomic-embed-text-v1.5']),columns);
});
