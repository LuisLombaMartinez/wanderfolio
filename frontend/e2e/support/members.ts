// Test-side access to the local Floci stack: puts a test Member back into
// "first login" state (temporary password) so the journey can be repeated.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'

// Must match infra/scripts/local-env.ts.
export const TEMPORARY_PASSWORD = 'Temporal#2026'
export const NEW_PASSWORD = 'Nuestro#Viaje2026'

export const MEMBERS = {
  mobile: { email: 'leo@viajecito.test', displayName: 'Leo' },
  desktop: { email: 'ana@viajecito.test', displayName: 'Ana' },
} as const

function localEnv(): Record<string, string> {
  const file = fileURLToPath(new URL('../../.env.local', import.meta.url))
  const env: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}

export function memberFor(projectName: string) {
  const member = MEMBERS[projectName as keyof typeof MEMBERS]
  if (!member) throw new Error(`No test Member for project ${projectName}`)
  return member
}

export async function resetToTemporaryPassword(email: string) {
  const env = localEnv()
  // Floci accepts any credentials; these are not AWS credentials.
  const cognito = new CognitoIdentityProviderClient({
    endpoint: env.FLOCI_ENDPOINT,
    region: 'eu-west-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  })
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.VITE_USER_POOL_ID,
      Username: email,
      Password: TEMPORARY_PASSWORD,
      Permanent: false,
    }),
  )
}
