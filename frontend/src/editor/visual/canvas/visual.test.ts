import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseSource, HTML_BYTES } from '../source/registry'
import { createProjection, MARKER } from './projection'
import { sanitizeCss, stylesheetPath } from './css'
import { validClearHover, validHello, validSelection } from './protocol'

const source =
  '<!doctype html>\r\n<html><head></head><body><div id="x"><p title="中文😀">你好😀 &amp;</p><p id="x">第二段</p></div></body></html>'
describe('source registry', () => {
  it('preserves UTF-16 ranges, CRLF, entities, attributes and duplicate IDs', () => {
    const r = parseSource('html', '/pages/a.html', source)
    const paragraphs = [...r.nodes.values()].filter((n) => n.tag === 'p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].id).not.toBe(paragraphs[1].id)
    const p = paragraphs[0]
    expect(source.slice(p.range!.start, p.range!.end)).toBe('<p title="中文😀">你好😀 &amp;</p>')
    expect(source.slice(p.attributes.title.start, p.attributes.title.end)).toBe('title="中文😀"')
    expect(source.slice(p.text[0].start, p.text[0].end)).toBe('你好😀 &amp;')
    expect(r.nodes.get(p.parentId!)?.children).toEqual(paragraphs.map((p) => p.id))
    expect(p.operations).toContain('structure')
    expect(r.source).toBe(source)
    expect(parseSource('html', '/pages/a.html', source).generation).not.toBe(r.generation)
  })
  it('marks implicit, malformed and special descendants read-only', () => {
    const text =
      '<table><tr><td>X</td></tr></table><p>missing<div>ok</div><svg><text>x</text></svg>'
    const r = parseSource('f', '/a.html', text)
    for (const tag of ['body', 'tbody', 'td', 'p', 'svg', 'text'])
      expect([...r.nodes.values()].find((n) => n.tag === tag)?.reason).toBeTruthy()
    expect(r.source).toBe(text)
  })
  it('rejects reordered source intervals and reserves text operations for leaf elements', () => {
    const r = parseSource(
      'f',
      '/a.html',
      '<!doctype html><html><head></head><body><table><div>foster</div><tr><td>cell</td></tr></table><p>text<b>mixed</b></p></body></html>',
    )
    expect([...r.nodes.values()].find((n) => n.tag === 'div')?.reason).toContain('重排')
    expect([...r.nodes.values()].find((n) => n.tag === 'p')?.operations).not.toContain('text')
    expect([...r.nodes.values()].find((n) => n.tag === 'b')?.operations).toContain('text')
  })
  it('budgets UTF-8 bytes', () => {
    expect(() => parseSource('f', '/a.html', '中'.repeat(Math.ceil(HTML_BYTES / 3)))).toThrow(
      '200 KiB',
    )
  })
})
describe('safe projection and CSS', () => {
  it('loads virtual CSS in source order and filters unsupported resources', () => {
    const text =
      '<html><head><link rel="stylesheet" href="../styles/a.css"><style>p{color:blue}</style><link rel="stylesheet" href="/styles/b.css"><link rel="stylesheet" href="https://evil/x.css"></head><body><p>hi</p></body></html>'
    const registry = parseSource('f', '/pages/a.html', text)
    const p = createProjection(registry, [
      {
        path: '/styles/a.css',
        language: 'css',
        source: '@import "x.css"; p{color:red;background:url(https://evil)}',
      },
      { path: '/styles/b.css', language: 'css', source: 'p{color:green}' },
    ])
    expect(p.srcdoc.indexOf('color:red')).toBeLessThan(p.srcdoc.indexOf('color:blue'))
    expect(p.srcdoc.indexOf('color:blue')).toBeLessThan(p.srcdoc.indexOf('color:green'))
    expect(p.srcdoc).not.toContain('@import')
    expect(p.srcdoc).not.toContain('https://evil')
    expect(p.issues.length).toBeGreaterThan(1)
    expect(registry.source).toBe(text)
    expect(stylesheetPath('/pages/a.html', '/styles/a.css')).toBe('/styles/a.css')
    expect(stylesheetPath('/a.html', '//evil/x.css')).toBeNull()
    expect(stylesheetPath('/a.html', '/%5cevil')).toBeNull()
  })
  it('removes execution/navigation capabilities and marker collisions', () => {
    const text = `<html><head><base href="https://evil"><meta http-equiv="refresh" content="0;url=https://evil"></head><body><script>window.hacked=1</script><p ${MARKER}="forged" onclick="hacked=1" style="background:url(javascript:evil);color:red">OK</p><a href="javascript:evil" target="_top">link</a><form action="https://evil"><button formaction="https://evil">go</button></form><iframe src="https://evil"></iframe><svg onload="hacked=1"></svg><img src="javascript:evil" onerror="hacked=1"></body></html>`
    const p = createProjection(parseSource('f', '/a.html', text), [])
    const doc = new DOMParser().parseFromString(p.srcdoc, 'text/html')
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(doc.querySelector('script')?.textContent).not.toContain('window.hacked')
    expect(
      doc.querySelector(
        'base,iframe,svg,[onclick],[onerror],[href],[action],[formaction],[target]',
      ),
    ).toBeNull()
    expect(doc.querySelector('p')?.getAttribute(MARKER)).not.toBe('forged')
    expect(doc.querySelector('head')?.firstElementChild?.getAttribute('http-equiv')).toBe(
      'Content-Security-Policy',
    )
  })
  it('encodes CSS escape attempts as data and rejects invalid CSS', () => {
    const p = createProjection(
      parseSource(
        'f',
        '/a.html',
        '<html><body><p>OK</p><link rel="stylesheet" href="/a.css"></body></html>',
      ),
      [
        {
          path: '/a.css',
          language: 'css',
          source: 'p::before{content:"</style><script>window.hacked=1</script>"}',
        },
      ],
    )
    expect(
      new DOMParser().parseFromString(p.srcdoc, 'text/html').querySelectorAll('script'),
    ).toHaveLength(1)
    expect(p.srcdoc).not.toContain('</style><script>')
    const script = new DOMParser()
      .parseFromString(p.srcdoc, 'text/html')
      .querySelector('script')!.textContent!
    expect(() => new Script(script)).not.toThrow()
    expect(sanitizeCss('p{color:red', [])).toBe('')
  })
  it('fails explicitly on CSS total and repeated reference budgets', () => {
    const html =
      '<html><head>' +
      '<link rel="stylesheet" href="/a.css">'.repeat(33) +
      '</head><body></body></html>'
    expect(() =>
      createProjection(parseSource('f', '/a.html', html), [
        { path: '/a.css', language: 'css', source: 'p{color:red}' },
      ]),
    ).toThrow('32')
    expect(() =>
      createProjection(parseSource('f', '/a.html', html), [
        { path: '/a.css', language: 'css', source: ' '.repeat(1024 * 1024 + 1) },
      ]),
    ).toThrow('1 MiB')
  })
})
describe('capability protocol', () => {
  it('rejects stale, forged, unknown, oversized and non-finite messages', () => {
    const r = parseSource('f', '/a.html', source)
    const nodeId = [...r.nodes.values()].find((n) => n.tag === 'p')!.id
    const valid = {
      type: 'select',
      fileId: 'f',
      generation: r.generation,
      nodeId,
      rect: { x: 1, y: 2, width: 30, height: 40 },
    }
    expect(validSelection(valid, r)).toBe(true)
    expect(validSelection({ ...valid, type: 'hover' }, r)).toBe(true)
    const clear = { type: 'clear-hover', fileId: 'f', generation: r.generation }
    expect(validClearHover(clear, r)).toBe(true)
    expect(validClearHover({ ...clear, generation: 'old' }, r)).toBe(false)
    expect(validClearHover({ ...clear, extra: 'x'.repeat(100000) }, r)).toBe(false)
    for (const change of [
      { generation: 'old' },
      { fileId: 'other' },
      { nodeId: 'fake' },
      { type: 'write' },
      { extra: 'x'.repeat(100000) },
      { rect: { x: Infinity, y: 0, width: 1, height: 1 } },
      { rect: { x: 0, y: 0, width: -1, height: 1 } },
    ])
      expect(validSelection({ ...valid, ...change }, r)).toBe(false)
    const hello = { type: 'hello', capability: 'secret', fileId: 'f', generation: r.generation }
    expect(validHello(hello, 'secret', r)).toBe(true)
    expect(validHello(hello, 'other', r)).toBe(false)
    expect(validHello({ ...hello, generation: 'old' }, 'secret', r)).toBe(false)
  })
})
