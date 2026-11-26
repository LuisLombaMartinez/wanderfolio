import type { Stage } from './album-stack.ts'

export interface DeployConfig {
  budgetAlertEmail?: string
  signingPublicKey?: string
}

export const STAGES: readonly Stage[] = ['stg', 'prod']

/** The repo variable and environment variable holding a stage's CloudFront public key. */
export function publicKeyVar(stage: Stage): string {
  return `CLOUDFRONT_PUBLIC_KEY_${stage === 'stg' ? 'STG' : 'PROD'}`
}

/**
 * Reads one stage's deploy-time settings from the environment.
 *
 * Every deployed stage needs its CloudFront public key (CLOUDFRONT_PUBLIC_KEY_STG / _PROD). Prod also
 * needs the budget email: the account's one budget lives in the prod stack, and staging never reads it.
 * Only the local stack (VIAJECITO_LOCAL set to exactly "1"; Floci has no Budgets) may go without them.
 * Passing just one of the two to prod is always a mistake, local or not, so that throws too.
 */
export function readDeployConfig(env: Record<string, string | undefined>, stage: Stage = 'prod'): DeployConfig {
  const keyVar = publicKeyVar(stage)
  const signingPublicKey = env[keyVar] || undefined
  if (stage === 'stg') {
    if (!signingPublicKey) throw new Error(`${keyVar} must be set (run infra/scripts/setup-wizard.sh once)`)
    return { signingPublicKey }
  }
  const budgetAlertEmail = env.BUDGET_ALERT_EMAIL || undefined
  if (Boolean(budgetAlertEmail) !== Boolean(signingPublicKey)) {
    throw new Error(`Set both BUDGET_ALERT_EMAIL and ${keyVar}, or neither (neither is only allowed with VIAJECITO_LOCAL=1)`)
  }
  if (env.VIAJECITO_LOCAL !== '1' && !budgetAlertEmail) {
    throw new Error(`BUDGET_ALERT_EMAIL and ${keyVar} must be set (run infra/scripts/setup-wizard.sh once)`)
  }
  return { budgetAlertEmail, signingPublicKey }
}

/**
 * Which stacks this run creates. `VIAJECITO_STAGE=stg|prod` builds just that one, so a deploy job only
 * needs its own stage's settings. Unset builds both (CI synth). The local stack is always just prod-shaped.
 */
export function selectStages(env: Record<string, string | undefined>): Stage[] {
  if (env.VIAJECITO_LOCAL === '1') return ['prod']
  const wanted = env.VIAJECITO_STAGE || undefined
  if (!wanted) return [...STAGES]
  if (wanted !== 'stg' && wanted !== 'prod') throw new Error(`VIAJECITO_STAGE must be "stg" or "prod", got "${wanted}"`)
  return [wanted]
}

/** The stack id of each stage. The deploy workflows run `cdk deploy` with these exact ids (ADR-0006). */
export const STACK_ID: Record<Stage, string> = { stg: 'ViajecitoStg', prod: 'Viajecito' }
