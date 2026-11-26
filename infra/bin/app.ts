import { App } from 'aws-cdk-lib'
import { AlbumStack, type Stage } from '../lib/album-stack.ts'
import { readDeployConfig, selectStages, STACK_ID } from '../lib/deploy-config.ts'

const local = process.env.VIAJECITO_LOCAL === '1'
const DESCRIPTION: Record<Stage, string> = {
  stg: 'Viajecito staging: a throwaway copy of the Album for checking changes in the real cloud',
  prod: 'Viajecito: the private photo Album of our Trips',
}

const app = new App()
for (const stage of selectStages(process.env)) {
  const { budgetAlertEmail, signingPublicKey } = readDeployConfig(process.env, stage)
  new AlbumStack(app, STACK_ID[stage], {
    stage,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-west-1' },
    description: DESCRIPTION[stage],
    local,
    budgetAlertEmail,
    signingPublicKey,
    // Local stack only: the SPA dev server uploads straight to the photo bucket.
    localSpaOrigin: local ? process.env.SPA_ORIGIN : undefined,
  })
}
