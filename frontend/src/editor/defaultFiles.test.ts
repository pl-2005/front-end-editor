import { describe, expect, it } from 'vitest'
import { DEFAULT_FILES } from './defaultFiles'

describe('DEFAULT_FILES', () => {
  it('loads the example JavaScript from the HTML entry', () => {
    const html = DEFAULT_FILES['/index.html']?.code

    expect(html).toContain('<script type="module" src="/index.js"></script>')
    expect(html).toContain('<meta charset="UTF-8">')
    expect(DEFAULT_FILES['/index.js']).toBeDefined()
  })

  it('supports modern JavaScript syntax in the example', () => {
    const javascript = DEFAULT_FILES['/index.js']?.code

    expect(javascript).toContain('?.addEventListener')
  })
})
