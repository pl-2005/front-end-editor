import { htmlDiagnostics } from './htmlDiagnostics'
self.onmessage = (event: MessageEvent<{ id: number; code: string }>) => {
  self.postMessage({ id: event.data.id, issues: htmlDiagnostics(event.data.code) })
}
