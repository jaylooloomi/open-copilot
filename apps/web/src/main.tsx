import { NotesApp, PlatformProvider } from '@oc/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { selectPlatform } from './platform/selectPlatform';

const platform = await selectPlatform();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PlatformProvider platform={platform}>
      <NotesApp />
    </PlatformProvider>
  </StrictMode>,
);
