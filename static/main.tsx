import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';
import '../app/mobile.css';
// One editor, one workflow engine. No auth gate, RSC runtime or server routes.
createRoot(document.getElementById('root')!).render(<Home/>);
