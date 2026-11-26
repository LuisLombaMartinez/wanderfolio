// Reads the outputs of the stack deployed to Floci (written by local-up.sh).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const OUTPUTS_PATH = fileURLToPath(new URL('../cdk-outputs.local.json', import.meta.url))

export interface LocalStack {
  flociPort: string
  endpoint: string
  userPoolId: string
  userPoolClientId: string
  apiId: string
  apiFunctionName: string
  tableName: string
  photoBucketName: string
  processingFunctionNames: string[]
  distributionId: string
}

export function readLocalStack(): LocalStack {
  const all = JSON.parse(readFileSync(OUTPUTS_PATH, 'utf8')) as Record<string, Record<string, string>>
  const o = all.Viajecito
  if (!o) throw new Error(`No Viajecito outputs in ${OUTPUTS_PATH}; run infra/scripts/local-up.sh`)
  const flociPort = process.env.FLOCI_PORT ?? '4600'
  return {
    flociPort,
    endpoint: `http://localhost:${flociPort}`,
    userPoolId: o.UserPoolId,
    userPoolClientId: o.UserPoolClientId,
    apiId: o.ApiId,
    apiFunctionName: o.ApiFunctionName,
    tableName: o.TableName,
    photoBucketName: o.PhotoBucketName,
    processingFunctionNames: [o.MarkProcessingFunctionName, o.ProcessImageFunctionName, o.MarkReadyFunctionName, o.MarkFailedFunctionName],
    distributionId: o.DistributionId,
  }
}

/** The two test Members every local stack gets. Emails must be typed in this exact case (Floci #7828). */
export const TEST_MEMBERS = [
  { email: 'leo@viajecito.test', displayName: 'Leo' },
  { email: 'ana@viajecito.test', displayName: 'Ana' },
] as const

/** Temporary password the test Members start with (first login must replace it). */
export const TEST_TEMPORARY_PASSWORD = 'Temporal#2026'
