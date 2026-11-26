// Creates the two test Members on the local stack and points the SPA at it.
// Run by local-up.sh after the deploy; safe to run again.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { TEST_MEMBERS, TEST_TEMPORARY_PASSWORD, readLocalStack } from './local-env.ts'

const stack = readLocalStack()
const cognito = new CognitoIdentityProviderClient({ endpoint: stack.endpoint, region: 'eu-west-1' })
const backendDir = fileURLToPath(new URL('../../backend', import.meta.url))

for (const member of TEST_MEMBERS) {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: stack.userPoolId,
        Username: member.email,
        TemporaryPassword: TEST_TEMPORARY_PASSWORD,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: member.email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    )
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) throw err
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: stack.userPoolId,
        Username: member.email,
        Password: TEST_TEMPORARY_PASSWORD,
        Permanent: false,
      }),
    )
  }
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: stack.userPoolId, Username: member.email }))
  const sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value
  if (!sub) throw new Error(`no sub for ${member.email}`)

  execFileSync('go', ['run', './cmd/seed-member', '-table', stack.tableName, '-id', sub, '-name', member.displayName], {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, AWS_ENDPOINT_URL: stack.endpoint },
  })
  console.log(`  ${member.email} / ${TEST_TEMPORARY_PASSWORD} (temporary)`)
}

// Warm the API Lambda: its first run pulls the arm64 runtime image (QEMU on x64 hosts),
// which can take longer than a browser test waits. A request with no claims just gets 401.
const lambda = new LambdaClient({ endpoint: stack.endpoint, region: 'eu-west-1' })
const warm = await lambda.send(
  new InvokeCommand({
    FunctionName: stack.apiFunctionName,
    Payload: JSON.stringify({
      version: '2.0',
      rawPath: '/api/me',
      requestContext: { http: { method: 'GET', path: '/api/me' } },
    }),
  }),
)
console.log(`Warmed the API Lambda (${warm.FunctionError ?? 'ok'})`)

// Same for the three photo-processing Lambdas (arm64 Python under QEMU: about a minute cold).
// The payload is junk on purpose, so they do nothing but start; errors here are expected.
for (const name of stack.processingFunctionNames) {
  const started = Date.now()
  const res = await lambda.send(new InvokeCommand({ FunctionName: name, Payload: JSON.stringify({ bucket: 'warm', key: 'warm' }) }))
  console.log(`Warmed ${name} in ${Math.round((Date.now() - started) / 1000)} s (${res.FunctionError ?? 'ok'})`)
}

// The SPA only ever uses relative /api URLs; Vite proxies them to the HTTP API.
// /api goes straight to execute-api because Floci's CloudFront drops the /api/*
// behaviour's policies (see the PR notes); production goes through CloudFront.
const envFile = fileURLToPath(new URL('../../frontend/.env.local', import.meta.url))
writeFileSync(
  envFile,
  [
    '# Written by infra/scripts/local-up.sh for the local Floci stack. Do not commit.',
    `VITE_USER_POOL_ID=${stack.userPoolId}`,
    `VITE_USER_POOL_CLIENT_ID=${stack.userPoolClientId}`,
    `VITE_COGNITO_ENDPOINT=${stack.endpoint}`,
    `API_PROXY_TARGET=http://${stack.apiId}.execute-api.localhost.floci.io:${stack.flociPort}`,
    // /media goes through the real distribution so the signed-cookie check runs (Floci serves it by host name).
    `MEDIA_PROXY_TARGET=http://${stack.distributionId.toLowerCase()}.cloudfront.localhost.floci.io:${stack.flociPort}`,
    `PHOTO_BUCKET=${stack.photoBucketName}`,
    `FLOCI_ENDPOINT=${stack.endpoint}`,
    '',
  ].join('\n'),
)
console.log(`Wrote ${envFile}`)
