import { render } from 'preact';
import './styles.css';
import { App } from './components/App.tsx';
import { initApp } from './store.ts';
import { installDragListeners } from './dnd.ts';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');

installDragListeners();
render(<App />, root);
void initApp();
