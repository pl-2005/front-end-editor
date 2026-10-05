declare module 'monaco-editor/esm/vs/basic-languages/*' {
  import type { languages } from 'monaco-editor'
  export const language: languages.IMonarchLanguage
}
interface Window { MonacoEnvironment?: import('monaco-editor').Environment }
