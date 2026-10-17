declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    function(name: string, callback: (...args: unknown[]) => string | number | null): void
    prepare(sql: string): {
      get(...params: unknown[]): unknown
      all(...params: unknown[]): unknown[]
      run(...params: unknown[]): { changes: number }
    }
    close(): void
  }
}
