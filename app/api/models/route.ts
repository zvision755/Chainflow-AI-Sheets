import { proxy } from '../../../server/proxy';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>proxy(request,'models');
