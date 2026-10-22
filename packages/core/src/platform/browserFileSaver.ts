import type { FileSaver } from './types';

const REVOKE_DELAY_MS = 1000;

export function createBrowserFileSaver(): FileSaver {
  return {
    async save(filename, data) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some browsers read the URL asynchronously after click(); revoke later.
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    },
  };
}
