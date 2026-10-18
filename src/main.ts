import './style.css';
import { App } from './ui/app';

const app = new App();
// dev-only handle for debugging in the browser console
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
