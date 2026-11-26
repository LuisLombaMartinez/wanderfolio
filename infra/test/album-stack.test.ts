import { readFileSync } from 'node:fs'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { beforeAll, describe, expect, it } from 'vitest'
import { AlbumStack } from '../lib/album-stack.ts'

const TEST_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----'

let template: Template

beforeAll(() => {
  // Skip asset bundling so the tests need neither Go nor Docker.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const stack = new AlbumStack(app, 'Test', {
    env: { account: '111111111111', region: 'eu-west-1' },
    budgetAlertEmail: 'alerts@example.com',
    signingPublicKey: TEST_PUBLIC_KEY,
  })
  template = Template.fromStack(stack)
})

type Resource = { Type: string; Properties: Record<string, unknown> }

function resources(type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][]
}

function distributionConfig() {
  const [[, dist]] = resources('AWS::CloudFront::Distribution')
  return dist.Properties.DistributionConfig as {
    DefaultCacheBehavior: Record<string, unknown>
    CacheBehaviors?: Record<string, unknown>[]
    CustomErrorResponses?: unknown[]
  }
}

describe('Cognito', () => {
  it('has self sign-up disabled', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    })
  })

  it('uses email as the username', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', { UsernameAttributes: ['email'] })
  })

  it('has a public SPA client using SRP with 365-day refresh tokens', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayEquals(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
      RefreshTokenValidity: 365 * 24 * 60,
      TokenValidityUnits: Match.objectLike({ RefreshToken: 'minutes' }),
    })
  })
})

describe('Hardening', () => {
  it('protects the user pool from deletion and asks for long passwords', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      DeletionProtection: 'ACTIVE',
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
    })
  })

  it('throttles the API stage', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: Match.anyValue(), ThrottlingBurstLimit: Match.anyValue() },
    })
  })

  it('serves the site with a strict Content-Security-Policy', () => {
    const [[, policy]] = resources('AWS::CloudFront::ResponseHeadersPolicy')
    const csp = (policy.Properties.ResponseHeadersPolicyConfig as {
      SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: unknown; Override: boolean } }
    }).SecurityHeadersConfig.ContentSecurityPolicy
    expect(csp.Override).toBe(true)
    // The policy holds a token (the photo bucket name), so it is an Fn::Join in the template.
    const text = JSON.stringify(csp.ContentSecurityPolicy)
    expect(text).toContain("default-src 'self'")
    expect(text).toContain("script-src 'self'")
    expect(text).not.toMatch(/script-src[^;]*unsafe/)
    expect(text).toContain("frame-ancestors 'none'")
    expect(text).toContain('connect-src')
  })
})

describe('HTTP API', () => {
  it('has a JWT authorizer on every route', () => {
    const routes = resources('AWS::ApiGatewayV2::Route')
    expect(routes.length).toBeGreaterThan(0)
    for (const [, route] of routes) {
      expect(route.Properties.AuthorizationType).toBe('JWT')
      expect(route.Properties.AuthorizerId).toBeDefined()
    }
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: { Audience: [Match.anyValue()], Issuer: Match.anyValue() },
    })
  })
})

describe('DynamoDB', () => {
  it('has point-in-time recovery on', () => {
    const tables = resources('AWS::DynamoDB::Table')
    expect(tables.length).toBeGreaterThan(0)
    for (const [, table] of tables) {
      expect(table.Properties.PointInTimeRecoverySpecification).toMatchObject({ PointInTimeRecoveryEnabled: true })
    }
  })
})

describe('Lambda', () => {
  it('lets the API write Trips to the table', () => {
    const actions = JSON.stringify(
      resources('AWS::IAM::Policy').flatMap(([, p]) => (p.Properties.PolicyDocument as { Statement: unknown[] }).Statement),
    )
    // BatchWriteItem is there to delete a Trip's Photo records in batches.
    for (const a of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 'dynamodb:Query']) {
      expect(actions).toContain(a)
    }
  })

  it('runs every function on arm64', () => {
    // Ours only: CDK's own helper functions (bucket notifications) are not ours to pin.
    const fns = resources('AWS::Lambda::Function').filter(([id]) => /^(Api|MarkProcessing|ProcessImage|MarkReady)Function/.test(id))
    expect(fns).toHaveLength(4)
    expect(fns.length).toBeGreaterThan(0)
    for (const [, fn] of fns) {
      expect(fn.Properties.Architectures).toEqual(['arm64'])
    }
  })
})

describe('CloudFront', () => {
  it('serves the site bucket through origin access control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2) // site bucket and photo bucket
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  it('rewrites client routes on the default behaviour only', () => {
    const config = distributionConfig()
    expect(config.DefaultCacheBehavior.FunctionAssociations).toEqual([
      expect.objectContaining({ EventType: 'viewer-request' }),
    ])
    for (const behaviour of config.CacheBehaviors ?? []) {
      expect(behaviour.FunctionAssociations, String(behaviour.PathPattern)).toBeUndefined()
    }
    expect(config.CustomErrorResponses).toBeUndefined()
  })

  it('sends /api/* to the HTTP API uncached, with Authorization forwarded and every method allowed', () => {
    const api = (distributionConfig().CacheBehaviors ?? []).find((b) => b.PathPattern === '/api/*')
    expect(api).toBeDefined()
    // Managed-CachingDisabled and Managed-AllViewerExceptHostHeader (forwards Authorization).
    expect(api!.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad')
    expect(api!.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac')
    expect(api!.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'])
    expect(api!.ViewerProtocolPolicy).toBe('https-only')
  })
})

function bareStack(props: { budgetAlertEmail?: string; signingPublicKey?: string; local?: boolean }) {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
  return Template.fromStack(new AlbumStack(app, 'Bare', { env: { account: '111111111111', region: 'eu-west-1' }, ...props }))
}

describe('Budget alarm', () => {
  it('limits spend to $5 a month and emails the address given at deploy time', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 5, Unit: 'USD' } }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({ Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }] }),
      ]),
    })
  })

  it('alerts at 80% of actual spend', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: {
            NotificationType: 'ACTUAL',
            ComparisonOperator: 'GREATER_THAN',
            Threshold: 80,
            ThresholdType: 'PERCENTAGE',
          },
        }),
      ]),
    })
  })

  it('alerts when actual spend goes over 100% of the $5 budget', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: {
            NotificationType: 'ACTUAL',
            ComparisonOperator: 'GREATER_THAN',
            Threshold: 100,
            ThresholdType: 'PERCENTAGE',
          },
        }),
      ]),
    })
  })

  it('alerts on forecasted overspend as well as actual, and nothing else', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({ Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 100 }) }),
      ]),
    })
    const [[, budget]] = resources('AWS::Budgets::Budget')
    expect(budget.Properties.NotificationsWithSubscribers).toHaveLength(3)
  })
})

describe('CloudFront signing key', () => {
  it('has exactly one public key and a key group holding it', () => {
    template.resourceCountIs('AWS::CloudFront::PublicKey', 1)
    template.resourceCountIs('AWS::CloudFront::KeyGroup', 1)
    template.hasResourceProperties('AWS::CloudFront::PublicKey', {
      PublicKeyConfig: Match.objectLike({ EncodedKey: TEST_PUBLIC_KEY }),
    })
    const [[publicKeyId]] = Object.entries(template.findResources('AWS::CloudFront::PublicKey'))
    template.hasResourceProperties('AWS::CloudFront::KeyGroup', {
      KeyGroupConfig: Match.objectLike({ Items: [{ Ref: publicKeyId }] }),
    })
  })

  it('exposes the key group and public key ids as outputs', () => {
    const [[keyGroupId]] = Object.entries(template.findResources('AWS::CloudFront::KeyGroup'))
    const [[publicKeyId]] = Object.entries(template.findResources('AWS::CloudFront::PublicKey'))
    template.hasOutput('MediaKeyGroupId', { Value: { Ref: keyGroupId } })
    template.hasOutput('MediaPublicKeyId', { Value: { Ref: publicKeyId } })
  })

  it('is absent when no key or email is given (local stack only)', () => {
    const bare = bareStack({ local: true })
    bare.resourceCountIs('AWS::Budgets::Budget', 0)
    bare.resourceCountIs('AWS::CloudFront::KeyGroup', 0)
    bare.resourceCountIs('AWS::CloudFront::PublicKey', 0)
  })

  it('creates only the budget when just the email is given', () => {
    const t = bareStack({ budgetAlertEmail: 'alerts@example.com', local: true })
    t.resourceCountIs('AWS::Budgets::Budget', 1)
    t.resourceCountIs('AWS::CloudFront::PublicKey', 0)
    t.resourceCountIs('AWS::CloudFront::KeyGroup', 0)
  })

  it('refuses to synth a non-local stack without a signing key', () => {
    expect(() => bareStack({ budgetAlertEmail: 'alerts@example.com' })).toThrow(/signingPublicKey/)
  })

  it('creates only the key group when just the key is given', () => {
    const t = bareStack({ signingPublicKey: TEST_PUBLIC_KEY })
    t.resourceCountIs('AWS::Budgets::Budget', 0)
    t.resourceCountIs('AWS::CloudFront::PublicKey', 1)
    t.resourceCountIs('AWS::CloudFront::KeyGroup', 1)
  })
})

function bucketByLogicalPrefix(prefix: string) {
  const found = resources('AWS::S3::Bucket').filter(([id]) => id.startsWith(prefix))
  expect(found).toHaveLength(1)
  return found[0]
}

describe('Photo bucket', () => {
  it('is private, encrypted, versioned and kept on stack deletion', () => {
    const [id, bucket] = bucketByLogicalPrefix('Photos')
    expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    })
    expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' })
    expect(bucket.Properties.BucketEncryption).toBeDefined()
    expect(template.toJSON().Resources[id].DeletionPolicy).toBe('Retain')
  })

  it('expires old versions after 30 days and aborts incomplete multipart uploads', () => {
    const [, bucket] = bucketByLogicalPrefix('Photos')
    const rules = (bucket.Properties.LifecycleConfiguration as { Rules: Record<string, unknown>[] }).Rules
    expect(rules).toContainEqual(
      expect.objectContaining({
        Status: 'Enabled',
        NoncurrentVersionExpiration: { NoncurrentDays: 30 },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      }),
    )
  })

  it('sends object events to EventBridge', () => {
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: { EventBridgeConfiguration: {} },
    })
  })

  it('accepts browser POST uploads from CloudFront origins only', () => {
    const [, bucket] = bucketByLogicalPrefix('Photos')
    const cors = (bucket.Properties.CorsConfiguration as { CorsRules: Record<string, unknown>[] }).CorsRules
    expect(cors).toHaveLength(1)
    expect(cors[0].AllowedMethods).toEqual(['POST'])
    expect(cors[0].AllowedOrigins).toEqual(['https://*.cloudfront.net'])
  })

  it('adds the local SPA origin only when asked', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const t = Template.fromStack(
      new AlbumStack(app, 'Local', {
        env: { account: '111111111111', region: 'eu-west-1' },
        localSpaOrigin: 'http://localhost:5184',
        local: true,
      }),
    )
    const [[, bucket]] = Object.entries(t.findResources('AWS::S3::Bucket')).filter(([id]) => id.startsWith('Photos')) as [string, Resource][]
    const cors = (bucket.Properties.CorsConfiguration as { CorsRules: { AllowedOrigins: string[] }[] }).CorsRules
    expect(cors[0].AllowedOrigins).toContain('http://localhost:5184')
  })

  it('has no public bucket policy statement', () => {
    for (const [, policy] of resources('AWS::S3::BucketPolicy')) {
      for (const st of (policy.Properties.PolicyDocument as { Statement: { Effect: string; Principal: unknown }[] }).Statement) {
        if (st.Effect === 'Allow') expect(JSON.stringify(st.Principal)).not.toBe('{"AWS":"*"}')
      }
    }
  })
})

describe('Media behaviour', () => {
  it('serves /media/* from the photo bucket through OAC, only to the trusted key group', () => {
    const media = (distributionConfig().CacheBehaviors ?? []).find((b) => b.PathPattern === '/media/*')
    expect(media).toBeDefined()
    const [[keyGroupId]] = Object.entries(template.findResources('AWS::CloudFront::KeyGroup'))
    expect(media!.TrustedKeyGroups).toEqual([{ Ref: keyGroupId }])
    expect(media!.AllowedMethods).toEqual(['GET', 'HEAD'])
    expect(media!.ViewerProtocolPolicy).toBe('redirect-to-https')
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2)
    // The only origin that is the photo bucket is the one behind /media/*.
    const [photoId] = bucketByLogicalPrefix('Photos')
    const origins = (distributionConfig() as unknown as { Origins: { Id: string; DomainName: unknown }[] }).Origins
    const mediaOrigin = origins.find((o) => o.Id === media!.TargetOriginId)
    expect(JSON.stringify(mediaOrigin!.DomainName)).toContain(photoId)
  })

  it('never puts the key group on the default or /api/* behaviours', () => {
    const config = distributionConfig()
    expect(config.DefaultCacheBehavior.TrustedKeyGroups).toBeUndefined()
    const api = (config.CacheBehaviors ?? []).find((b) => b.PathPattern === '/api/*')
    expect(api!.TrustedKeyGroups).toBeUndefined()
  })

  it('has no /media/* behaviour without a signing key', () => {
    const t = bareStack({ local: true })
    const [[, dist]] = Object.entries(t.findResources('AWS::CloudFront::Distribution')) as [string, Resource][]
    const behaviours = (dist.Properties.DistributionConfig as { CacheBehaviors?: { PathPattern: string }[] }).CacheBehaviors ?? []
    expect(behaviours.map((b) => b.PathPattern)).not.toContain('/media/*')
  })

  it('allows the browser to POST uploads to the photo bucket in the CSP', () => {
    const [[, policy]] = resources('AWS::CloudFront::ResponseHeadersPolicy')
    const csp = JSON.stringify(policy.Properties)
    expect(csp).toContain('.s3.eu-west-1.amazonaws.com')
  })
})

describe('Media response headers', () => {
  it('stops browsers sniffing photos', () => {
    const media = (distributionConfig().CacheBehaviors ?? []).find((b) => b.PathPattern === '/media/*') as unknown as {
      ResponseHeadersPolicyId: unknown
    }
    const policies = resources('AWS::CloudFront::ResponseHeadersPolicy')
    const match = policies.find(([id]) => JSON.stringify(media.ResponseHeadersPolicyId).includes(id))
    expect(match).toBeDefined()
    expect(match![1].Properties.ResponseHeadersPolicyConfig).toMatchObject({
      SecurityHeadersConfig: {
        ContentTypeOptions: { Override: true },
        ContentSecurityPolicy: { ContentSecurityPolicy: "default-src 'none'; sandbox", Override: true },
      },
    })
  })

  // Real CloudFront rejects these as custom headers (Floci does not), failing the deploy.
  it('never sets a security header as a custom header', () => {
    const security = ['content-security-policy', 'strict-transport-security', 'x-content-type-options',
      'x-frame-options', 'x-xss-protection', 'referrer-policy']
    for (const [, policy] of resources('AWS::CloudFront::ResponseHeadersPolicy')) {
      const config = policy.Properties.ResponseHeadersPolicyConfig as {
        CustomHeadersConfig?: { Items: { Header: string }[] }
      }
      for (const item of config.CustomHeadersConfig?.Items ?? []) {
        expect(security).not.toContain(item.Header.toLowerCase())
      }
    }
  })
})

describe('API Lambda wiring', () => {
  function apiFunction() {
    const found = resources('AWS::Lambda::Function').filter(([id]) => id.startsWith('ApiFunction'))
    expect(found).toHaveLength(1)
    return found[0][1]
  }
  function statementsFor(roleLogicalPrefix: string) {
    return resources('AWS::IAM::Policy')
      .filter(([id]) => id.startsWith(roleLogicalPrefix))
      .flatMap(([, p]) => (p.Properties.PolicyDocument as { Statement: { Action: string | string[]; Resource: unknown }[] }).Statement)
  }

  it('gets the environment cmd/api needs to start', () => {
    const env = (apiFunction().Properties.Environment as { Variables: Record<string, unknown> }).Variables
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(['TABLE_NAME', 'PHOTO_BUCKET', 'MEDIA_SIGNING_KEY_PARAM', 'MEDIA_KEY_PAIR_ID']),
    )
    expect(env.MEDIA_SIGNING_KEY_PARAM).toBe('/viajecito/prod/cloudfront/signing-private-key')
    const [[publicKeyId]] = Object.entries(template.findResources('AWS::CloudFront::PublicKey'))
    expect(env.MEDIA_KEY_PAIR_ID).toEqual({ Ref: publicKeyId })
  })

  it('opens the cookie Resource normally, and empties MEDIA_COOKIE_RESOURCE only on the local stack', () => {
    const env = (apiFunction().Properties.Environment as { Variables: Record<string, unknown> }).Variables
    expect(env).not.toHaveProperty('MEDIA_COOKIE_RESOURCE')
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const t = Template.fromStack(new AlbumStack(app, 'L', { env: { account: '111111111111', region: 'eu-west-1' }, local: true }))
    const fn = Object.entries(t.findResources('AWS::Lambda::Function')).find(([id]) => id.startsWith('ApiFunction'))![1] as Resource
    expect((fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables.MEDIA_COOKIE_RESOURCE).toBe('')
  })

  it('may only sign uploads for originals/ and read the signing key parameter', () => {
    const st = statementsFor('ApiFunctionServiceRoleDefaultPolicy')
    const put = st.find((s) => s.Action === 's3:PutObject')
    expect(JSON.stringify(put!.Resource)).toContain('/originals/*')
    expect(JSON.stringify(put!.Resource)).not.toContain('media')
    const ssm = st.find((s) => s.Action === 'ssm:GetParameter')
    expect(JSON.stringify(ssm!.Resource)).toContain('parameter/viajecito/prod/cloudfront/signing-private-key')
    expect(JSON.stringify(st)).not.toContain('s3:GetObject')
    expect(JSON.stringify(st)).not.toContain('s3:DeleteObjectVersion')
  })

  it('may delete only originals/ and media/ objects (a delete marker; versions stay recoverable)', () => {
    const st = statementsFor('ApiFunctionServiceRoleDefaultPolicy')
    const del = st.find((s) => s.Action === 's3:DeleteObject')
    const res = JSON.stringify(del!.Resource)
    expect(res).toContain('/originals/*')
    expect(res).toContain('/media/*')
    expect(JSON.stringify(del!.Resource)).not.toContain('"/*"')
    const ddb = st.find((s) => Array.isArray(s.Action) && s.Action.includes('dynamodb:BatchWriteItem'))
    expect(ddb).toBeDefined()
  })
})

describe('Photo processing', () => {
  const fnByPrefix = (prefix: string) => resources('AWS::Lambda::Function').filter(([id]) => id.startsWith(prefix))

  it('runs four Python 3.13 arm64 functions with enough memory and time to resize', () => {
    for (const [prefix, handler] of [
      ['MarkProcessingFunction', 'mark_processing'],
      ['ProcessImageFunction', 'process_image'],
      ['MarkReadyFunction', 'mark_ready'],
      ['MarkFailedFunction', 'mark_failed'],
    ]) {
      const [[, fn]] = fnByPrefix(prefix)
      expect(fn.Properties).toMatchObject({
        Runtime: 'python3.13',
        Architectures: ['arm64'],
        Handler: `viajecito_processing.handlers.${handler}`,
      })
    }
    const [[, image]] = fnByPrefix('ProcessImageFunction')
    expect(image.Properties.MemorySize as number).toBeGreaterThanOrEqual(1024)
    expect(image.Properties.Timeout as number).toBeGreaterThanOrEqual(60)
  })

  it('gives each step only what it needs', () => {
    const actionsOf = (prefix: string) =>
      resources('AWS::IAM::Policy')
        .filter(([id]) => id.startsWith(`${prefix}ServiceRoleDefaultPolicy`))
        .flatMap(([, p]) => (p.Properties.PolicyDocument as { Statement: { Action: string | string[]; Resource: unknown }[] }).Statement)
    const flat = (st: { Action: string | string[] }[]) => st.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action])).sort()
    expect(flat(actionsOf('MarkProcessingFunction'))).toEqual(['dynamodb:UpdateItem'])
    expect(flat(actionsOf('MarkReadyFunction'))).toEqual(['dynamodb:UpdateItem'])
    expect(flat(actionsOf('MarkFailedFunction'))).toEqual(['dynamodb:UpdateItem'])
    const image = actionsOf('ProcessImageFunction')
    expect(flat(image)).toEqual(['s3:GetObject', 's3:PutObject'])
    const get = image.find((s) => s.Action === 's3:GetObject')!
    const put = image.find((s) => s.Action === 's3:PutObject')!
    expect(JSON.stringify(get.Resource)).toContain('/originals/*')
    expect(JSON.stringify(put.Resource)).toContain('/media/*')
  })

  it('is an Express workflow that retries service errors, ends quietly when the Photo is gone', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineType: 'EXPRESS' })
    const [[, sm]] = resources('AWS::StepFunctions::StateMachine')
    const def = JSON.stringify(sm.Properties.DefinitionString)
    for (const s of ['MarkProcessing', 'Gone?', 'ProcessImage', 'MarkReady', 'Lambda.ServiceException', '$.gone']) {
      expect(def).toContain(s)
    }
  })

  it('catches every failure into MarkFailed, retries transient errors, never UnreadableImage', () => {
    const [[, sm]] = resources('AWS::StepFunctions::StateMachine')
    const parts = (sm.Properties.DefinitionString as { 'Fn::Join': [string, unknown[]] })['Fn::Join'][1]
    const json = parts.map((p) => (typeof p === 'string' ? p : 'ARN')).join('')
    const states = JSON.parse(json).States as Record<
      string,
      { Catch?: { ErrorEquals: string[]; ResultPath: string; Next: string }[]; Retry?: { ErrorEquals: string[]; BackoffRate: number; MaxAttempts?: number }[] }
    >
    for (const name of ['MarkProcessing', 'ProcessImage', 'MarkReady']) {
      expect(states[name].Catch).toEqual([{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' }])
      const retry = states[name].Retry!
      expect(retry.flatMap((r) => r.ErrorEquals)).toEqual(
        expect.arrayContaining(['Lambda.ServiceException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException']),
      )
      // UnreadableImage comes first with no attempts, so it stays final even if a later retrier matches it.
      expect(retry[0]).toMatchObject({ ErrorEquals: ['UnreadableImage'], MaxAttempts: 0 })
      // Handler exceptions (e.g. an S3 ClientError) and timeouts are retried with backoff too.
      const handler = retry.find((r) => r.ErrorEquals.includes('States.TaskFailed'))!
      expect(handler.ErrorEquals).toEqual(expect.arrayContaining(['States.TaskFailed', 'States.Timeout']))
      expect(retry.indexOf(handler)).toBeGreaterThan(0)
      expect((handler as unknown as { MaxAttempts: number }).MaxAttempts).toBeGreaterThanOrEqual(2)
      expect(handler.BackoffRate).toBeGreaterThan(1)
      expect(retry.flatMap((r) => r.ErrorEquals).filter((e) => e === 'UnreadableImage')).toHaveLength(1)
      expect(retry.flatMap((r) => r.ErrorEquals)).not.toContain('States.ALL')
      expect(retry[1].BackoffRate).toBeGreaterThan(1)
    }
    expect(states.MarkFailed.Catch).toBeUndefined()
    // MarkFailed must never leave a Photo in `processing`: it retries service, SDK and throttle errors.
    const mf = states.MarkFailed.Retry!
    expect(mf.flatMap((r) => r.ErrorEquals)).toEqual(
      expect.arrayContaining(['Lambda.ServiceException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException']),
    )
    const svc = mf.find((r) => r.ErrorEquals.includes('Lambda.ServiceException'))!
    expect(svc.BackoffRate).toBeGreaterThan(1)
    expect(svc.MaxAttempts).toBeGreaterThanOrEqual(5)
    expect(mf.find((r) => r.ErrorEquals.includes('States.TaskFailed'))!.MaxAttempts).toBeGreaterThanOrEqual(5)
  })

  it('lets the API start the workflow for retries, on that state machine only', () => {
    const [[smId]] = resources('AWS::StepFunctions::StateMachine')
    const [[, api]] = resources('AWS::Lambda::Function').filter(([id]) => id.startsWith('ApiFunction'))
    const env = (api.Properties.Environment as { Variables: Record<string, unknown> }).Variables
    expect(env.PROCESSING_STATE_MACHINE_ARN).toEqual({ Ref: smId })
    const start = resources('AWS::IAM::Policy')
      .filter(([id]) => id.startsWith('ApiFunctionServiceRoleDefaultPolicy'))
      .flatMap(([, p]) => (p.Properties.PolicyDocument as { Statement: { Action: string | string[]; Resource: unknown }[] }).Statement)
      .filter((s) => JSON.stringify(s.Action).includes('states:'))
    expect(start).toHaveLength(1)
    expect(start[0].Action).toBe('states:StartExecution')
    expect(start[0].Resource).toEqual({ Ref: smId })
  })

  it('bundles pillow-heif and gives ProcessImage at least 1024 MB', () => {
    const req = readFileSync(new URL('../../backend/processing/requirements.txt', import.meta.url), 'utf8')
    expect(req).toMatch(/^pillow-heif==/m)
    const [[, image]] = fnByPrefix('ProcessImageFunction')
    expect(image.Properties.MemorySize as number).toBeGreaterThanOrEqual(1024)
  })

  it('starts the workflow when an original lands in the photo bucket, passing bucket and key', () => {
    const [[, rule]] = resources('AWS::Events::Rule')
    const pattern = rule.Properties.EventPattern as {
      source: string[]
      'detail-type': string[]
      detail: { bucket: { name: unknown[] }; object: { key: unknown[] } }
    }
    expect(pattern.source).toEqual(['aws.s3'])
    expect(pattern['detail-type']).toEqual(['Object Created'])
    expect(pattern.detail.object.key).toEqual([{ prefix: 'originals/' }])
    expect(JSON.stringify(pattern.detail.bucket.name)).toContain('Photos')
    const target = (rule.Properties.Targets as { InputTransformer: { InputPathsMap: Record<string, string> } }[])[0]
    expect(target.InputTransformer.InputPathsMap).toEqual({
      'detail-bucket-name': '$.detail.bucket.name',
      'detail-object-key': '$.detail.object.key',
    })
  })
})

describe('Stages (ADR-0006)', () => {
  function stageStack(stage: 'stg' | 'prod', id = stage === 'stg' ? 'ViajecitoStg' : 'Viajecito') {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const stack = new AlbumStack(app, id, {
      stage,
      env: { account: '111111111111', region: 'eu-west-1' },
      budgetAlertEmail: 'alerts@example.com',
      signingPublicKey: TEST_PUBLIC_KEY,
    })
    return Template.fromStack(stack)
  }
  const stg = stageStack('stg')
  const prod = stageStack('prod')
  const dataTypes = ['AWS::Cognito::UserPool', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket']

  it('is prod when no stage is given', () => {
    template.resourceCountIs('AWS::Budgets::Budget', 1)
    expect(Object.values(template.findResources('AWS::DynamoDB::Table'))[0].DeletionPolicy).toBe('Retain')
  })

  it('staging destroys its user pool, table and both buckets with the stack', () => {
    for (const type of dataTypes) {
      const found = Object.entries(stg.findResources(type))
      expect(found.length).toBeGreaterThan(0)
      for (const [id, r] of found) {
        // The auto-delete helper's own resources are not in this list (they are custom resources).
        expect(r.DeletionPolicy, id).toBe('Delete')
        expect(r.UpdateReplacePolicy, id).toBe('Delete')
      }
    }
    expect(Object.keys(stg.findResources('AWS::S3::Bucket'))).toHaveLength(2)
    stg.hasResourceProperties('AWS::Cognito::UserPool', { DeletionProtection: 'INACTIVE' })
  })

  it('staging empties both buckets when it is deleted', () => {
    expect(Object.keys(stg.findResources('Custom::S3AutoDeleteObjects'))).toHaveLength(2)
  })

  it('staging still has point-in-time recovery, private buckets and sign-up disabled', () => {
    stg.hasResourceProperties('AWS::DynamoDB::Table', { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })
    stg.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } })
    for (const [, b] of Object.entries(stg.findResources('AWS::S3::Bucket'))) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      })
    }
  })

  it('prod retains everything and has no auto-delete', () => {
    for (const type of dataTypes) {
      for (const [id, r] of Object.entries(prod.findResources(type))) {
        expect(r.DeletionPolicy, id).toBe('Retain')
      }
    }
    prod.resourceCountIs('Custom::S3AutoDeleteObjects', 0)
    prod.hasResourceProperties('AWS::Cognito::UserPool', { DeletionProtection: 'ACTIVE' })
  })

  it('the one budget is in prod; staging creates none even when given the email', () => {
    prod.resourceCountIs('AWS::Budgets::Budget', 1)
    stg.resourceCountIs('AWS::Budgets::Budget', 0)
  })

  it('each stage reads and is allowed to read only its own signing key parameter', () => {
    for (const [t, stage] of [[stg, 'stg'], [prod, 'prod']] as const) {
      const fn = Object.values(t.findResources('AWS::Lambda::Function')).find((f) => JSON.stringify(f).includes('MEDIA_SIGNING_KEY_PARAM'))!
      const env = (fn.Properties.Environment as { Variables: Record<string, unknown> }).Variables
      expect(env.MEDIA_SIGNING_KEY_PARAM).toBe(`/viajecito/${stage}/cloudfront/signing-private-key`)
      const policies = Object.values(t.findResources('AWS::IAM::Policy'))
      const ssm = policies
        .flatMap((p) => (p.Properties.PolicyDocument as { Statement: { Action: string | string[]; Resource: unknown }[] }).Statement)
        .filter((st) => st.Action === 'ssm:GetParameter')
      expect(ssm).toHaveLength(1)
      expect(JSON.stringify(ssm[0].Resource)).toContain(`parameter/viajecito/${stage}/cloudfront/signing-private-key`)
    }
  })

  it('each stage has its own public key and key group, and the key group guards /media/*', () => {
    for (const t of [stg, prod]) {
      t.resourceCountIs('AWS::CloudFront::PublicKey', 1)
      t.resourceCountIs('AWS::CloudFront::KeyGroup', 1)
    }
  })

  it('both stacks synth side by side in one app', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const env = { account: '111111111111', region: 'eu-west-1' }
    new AlbumStack(app, 'ViajecitoStg', { stage: 'stg', env, signingPublicKey: TEST_PUBLIC_KEY })
    new AlbumStack(app, 'Viajecito', { stage: 'prod', env, signingPublicKey: TEST_PUBLIC_KEY, budgetAlertEmail: 'a@example.com' })
    expect(app.synth().stacks.map((x) => x.stackName).sort()).toEqual(['Viajecito', 'ViajecitoStg'])
  })

  it('refuses a staging stack that is also local', () => {
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } })
    expect(() => new AlbumStack(app, 'X', { stage: 'stg', local: true })).toThrow(/prod-shaped/)
  })

  it('the two stacks share no physical name', () => {
    // Explicit physical names are top-level string properties such as BucketName or FunctionName, on the
    // resource types whose names are unique per account and region. (Display names, such as the HTTP API's,
    // and inline policy names, which live inside one role, may repeat.)
    const unique = /^AWS::(S3::Bucket|DynamoDB::Table|Lambda::Function|Logs::LogGroup|StepFunctions::StateMachine|IAM::Role|SSM::Parameter|Budgets::Budget|CloudFront::(Function|KeyGroup|PublicKey)|Events::Rule|Cognito::UserPoolDomain)$/
    const names = (t: Template) =>
      Object.values(t.toJSON().Resources as Record<string, Resource>)
        .filter((r) => unique.test(r.Type))
        .flatMap((r) => [
          ...Object.entries(r.Properties ?? {})
            // Literal names and token-built ones (Fn::Join and friends) alike, compared as JSON.
            .filter(([k]) => /Name$/.test(k))
            .map(([k, v]) => `${r.Type}.${k}=${JSON.stringify(v)}`),
        ])
    const stgNames = new Set(names(stg))
    // Any name written into a template must differ between stages (today only the prod budget has one).
    for (const n of names(prod)) expect(stgNames.has(n), n).toBe(false)
  })
})
