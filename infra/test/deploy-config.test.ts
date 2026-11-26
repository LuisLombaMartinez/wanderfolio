import { describe, expect, it } from 'vitest'
import { publicKeyVar, readDeployConfig, selectStages, STACK_ID } from '../lib/deploy-config.ts'

const both = { BUDGET_ALERT_EMAIL: 'a@example.com', CLOUDFRONT_PUBLIC_KEY_PROD: 'KEY' }

describe('readDeployConfig (prod)', () => {
  it('returns both settings when both are present', () => {
    expect(readDeployConfig(both)).toEqual({ budgetAlertEmail: 'a@example.com', signingPublicKey: 'KEY' })
    expect(readDeployConfig(both, 'prod')).toEqual({ budgetAlertEmail: 'a@example.com', signingPublicKey: 'KEY' })
  })

  it('does not read the staging key', () => {
    expect(() => readDeployConfig({ BUDGET_ALERT_EMAIL: 'a@example.com', CLOUDFRONT_PUBLIC_KEY_STG: 'KEY' })).toThrow(/both/i)
  })

  it('throws in production when both are missing', () => {
    expect(() => readDeployConfig({})).toThrow(/must be set/)
    expect(() => readDeployConfig({ BUDGET_ALERT_EMAIL: '', CLOUDFRONT_PUBLIC_KEY_PROD: '' })).toThrow(/must be set/)
  })

  it('throws when only one is set, in production and in local mode', () => {
    for (const local of [undefined, '1']) {
      expect(() => readDeployConfig({ VIAJECITO_LOCAL: local, BUDGET_ALERT_EMAIL: 'a@example.com' })).toThrow(/both/i)
      expect(() => readDeployConfig({ VIAJECITO_LOCAL: local, CLOUDFRONT_PUBLIC_KEY_PROD: 'KEY' })).toThrow(/both/i)
    }
  })

  it('allows neither only when VIAJECITO_LOCAL is exactly "1"', () => {
    expect(readDeployConfig({ VIAJECITO_LOCAL: '1' })).toEqual({ budgetAlertEmail: undefined, signingPublicKey: undefined })
    for (const v of ['true', '0', 'yes', '']) {
      expect(() => readDeployConfig({ VIAJECITO_LOCAL: v })).toThrow(/must be set/)
    }
  })
})

describe('readDeployConfig (stg)', () => {
  it('needs only the staging key and ignores the budget email', () => {
    expect(readDeployConfig({ CLOUDFRONT_PUBLIC_KEY_STG: 'KEY' }, 'stg')).toEqual({ signingPublicKey: 'KEY' })
    expect(readDeployConfig({ CLOUDFRONT_PUBLIC_KEY_STG: 'KEY', BUDGET_ALERT_EMAIL: 'a@example.com' }, 'stg')).toEqual({ signingPublicKey: 'KEY' })
  })

  it('throws without the staging key, even in local mode and with the prod key set', () => {
    expect(() => readDeployConfig({}, 'stg')).toThrow(/CLOUDFRONT_PUBLIC_KEY_STG/)
    expect(() => readDeployConfig({ ...both, VIAJECITO_LOCAL: '1' }, 'stg')).toThrow(/CLOUDFRONT_PUBLIC_KEY_STG/)
  })
})

describe('selectStages', () => {
  it('builds both stacks by default, in staging-first order', () => {
    expect(selectStages({})).toEqual(['stg', 'prod'])
  })
  it('builds just the requested stage', () => {
    expect(selectStages({ VIAJECITO_STAGE: 'stg' })).toEqual(['stg'])
    expect(selectStages({ VIAJECITO_STAGE: 'prod' })).toEqual(['prod'])
  })
  it('rejects an unknown stage', () => {
    expect(() => selectStages({ VIAJECITO_STAGE: 'dev' })).toThrow(/stg.*prod/)
  })
  it('the local stack is always the single prod-shaped stack', () => {
    expect(selectStages({ VIAJECITO_LOCAL: '1' })).toEqual(['prod'])
  })
})

describe('publicKeyVar', () => {
  it('has one variable per stage', () => {
    expect(publicKeyVar('stg')).toBe('CLOUDFRONT_PUBLIC_KEY_STG')
    expect(publicKeyVar('prod')).toBe('CLOUDFRONT_PUBLIC_KEY_PROD')
  })
})

describe('STACK_ID', () => {
  it('matches the ids the deploy workflows and the wizard use', () => {
    expect(STACK_ID).toEqual({ stg: 'ViajecitoStg', prod: 'Viajecito' })
  })
})
