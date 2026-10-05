import { describe, expect, it } from 'vitest'
import { htmlDiagnostics } from './htmlDiagnostics'
describe('HTML diagnostics', () => {
  it('reports mismatched tags and invalid/duplicate attributes', () => {
    const issues = htmlDiagnostics('<div unknown="x" id="a" id="b"><span></div>')
    expect(issues.some(x => x.message.includes('未关闭'))).toBe(true)
    expect(issues.some(x => x.message.includes('重复属性'))).toBe(true)
    expect(issues.some(x => x.message.includes('未知 div 属性'))).toBe(true)
  })
  it('accepts valid HTML, optional tags, raw JS and custom elements', () => {
    expect(htmlDiagnostics('<!doctype html><html><head><meta charset="UTF-8"></head><body><ul><li>A<li>B</ul><script>if (a < b) console.log(a)</script><my-widget data-x="1"></my-widget></body></html>')).toEqual([])
  })
})
