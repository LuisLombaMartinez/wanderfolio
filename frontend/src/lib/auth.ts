// Member login through Cognito (real in prod, Floci locally). Amplify keeps the
// tokens in localStorage and refreshes them silently with the 365-day refresh token.
import { Amplify } from 'aws-amplify'
import { confirmSignIn, fetchAuthSession, signIn, signOut } from 'aws-amplify/auth'

let configured = false

/** Configures Amplify once from the build-time environment. */
export function configureAuth() {
  if (configured) return
  const userPoolId = import.meta.env.VITE_USER_POOL_ID
  const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID
  if (!userPoolId || !userPoolClientId) {
    throw new Error('VITE_USER_POOL_ID and VITE_USER_POOL_CLIENT_ID must be set at build time')
  }
  // Only the local stack sets a custom endpoint (Floci); production uses Cognito's default.
  const userPoolEndpoint = import.meta.env.VITE_COGNITO_ENDPOINT || undefined
  Amplify.configure({
    Auth: { Cognito: { userPoolId, userPoolClientId, ...(userPoolEndpoint ? { userPoolEndpoint } : {}) } },
  })
  configured = true
}

export type LoginStep = 'done' | 'new-password'

function toStep(signInStep: string): LoginStep {
  if (signInStep === 'DONE') return 'done'
  if (signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') return 'new-password'
  throw new Error(`Unsupported sign-in step: ${signInStep}`)
}

/** Logs in with email and password (SRP). First logins must then set a new password. */
export async function logIn(email: string, password: string): Promise<LoginStep> {
  const attempt = () =>
    signIn({ username: email.trim(), password, options: { authFlowType: 'USER_SRP_AUTH' } })
  try {
    return toStep((await attempt()).nextStep.signInStep)
  } catch (err) {
    // A saved session the app couldn't use (e.g. the API was unreachable at boot)
    // must not block a fresh login: drop it and try once more.
    if (!(err instanceof Error) || err.name !== 'UserAlreadyAuthenticatedException') throw err
    await signOut()
    return toStep((await attempt()).nextStep.signInStep)
  }
}

/** Answers Cognito's new-password challenge after a first login. */
export async function setNewPassword(newPassword: string): Promise<LoginStep> {
  const { nextStep } = await confirmSignIn({ challengeResponse: newPassword })
  return toStep(nextStep.signInStep)
}

export async function logOut() {
  await signOut()
}

/** The current access token, refreshed if needed, or undefined when logged out. */
export async function accessToken(): Promise<string | undefined> {
  try {
    const session = await fetchAuthSession()
    return session.tokens?.accessToken?.toString()
  } catch {
    return undefined
  }
}
