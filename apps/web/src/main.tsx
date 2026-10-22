import { selectPlatform } from './platform/selectPlatform';
import { startApp } from './startApp';

await startApp(document.getElementById('root') as HTMLElement, selectPlatform);
