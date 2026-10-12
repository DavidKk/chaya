import type { AgentAccountSummary, AgentAuthChallenge, RemoteAuthProvider } from '@/lib/game-agent/providers'

export interface AuthAttemptHandle {
  challenge: AgentAuthChallenge
  submitCode?(code: string): Promise<void>
  /** For remote adapters, resolving means the staging directory already holds complete credentials. */
  completed: Promise<{ account: AgentAccountSummary }>
  cancel(): Promise<void>
}

export interface RemoteAuthAdapter {
  provider: RemoteAuthProvider
  /** Files persisted as ciphertext, relative to the CLI home directory. */
  credentialFiles: readonly string[]
  /** Non-secret config every runtime copy needs (written into staging and each lease). */
  extraFiles: () => Record<string, string>
  /** `env` carries the profile's proxy variables (empty when it has none). */
  start(input: { stagingDir: string; signal: AbortSignal; env: Record<string, string> }): Promise<AuthAttemptHandle>
  /** Provider-side logout; failures never block deleting the local ciphertext. */
  logout?(input: { runtimeDir: string; signal: AbortSignal; env: Record<string, string> }): Promise<void>
}
