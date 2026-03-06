import type { ElectronApi } from '../../preload';

export const electronApi = (
  window as unknown as Window & { electronApi: ElectronApi }
).electronApi;
