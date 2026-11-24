import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'

describe('IPC契約', () => {
  it('チャンネル名が重複しない', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
