/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USER_POOL_ID: string
  readonly VITE_USER_POOL_CLIENT_ID: string
  /** Only set for the local Floci stack; production uses Cognito's own endpoint. */
  readonly VITE_COGNITO_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
