import { json } from '../../../server/proxy';
export const dynamic='force-dynamic';
export const GET=()=>json({providers:['openai','deepseek','custom'],codex:false});
