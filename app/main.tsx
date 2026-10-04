import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import './globals.css';
import './racelab.css';
import Home from './page';

createRoot(document.getElementById('root')!).render(<Home />);
