declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked'
  const TerminalRenderer: MarkedExtension
  export default TerminalRenderer
}
