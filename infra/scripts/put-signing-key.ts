// Stores the local CloudFront signing private key in Floci's SSM, where the API Lambda reads it
// (the same stage parameter the setup wizard fills in production). Usage: tsx put-signing-key.ts <private.pem>
import { readFileSync } from 'node:fs'
import { signingKeyParam } from '../lib/album-stack.ts'
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'

const [pemPath, stage = 'prod'] = process.argv.slice(2)
if (stage !== 'stg' && stage !== 'prod') throw new Error('stage must be stg or prod')
if (!pemPath) throw new Error('usage: put-signing-key.ts <private.pem> [stg|prod]')
const ssm = new SSMClient({ endpoint: process.env.AWS_ENDPOINT_URL, region: 'eu-west-1' })
await ssm.send(
  new PutParameterCommand({
    Name: signingKeyParam(stage),
    Type: 'SecureString',
    Overwrite: true,
    Value: readFileSync(pemPath, 'utf8'),
  }),
)
console.log('  signing key stored in SSM')
