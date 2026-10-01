import { render } from 'preact';
import '@fontsource-variable/bitter/index.css';
import '@fontsource-variable/bitter/wght-italic.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import './theme.ts';
import './styles.css';
import { App } from './components/App.tsx';
import { initApp } from './store.ts';
import { installDragListeners } from './dnd.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');

installDragListeners();
render(<App />, root);
void initApp();
