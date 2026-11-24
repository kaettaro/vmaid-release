import type { VMaidApi } from '../shared/ipc'

declare global {
  interface Window {
    vmaid: VMaidApi
  }
}
