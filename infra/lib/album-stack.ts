import { execFileSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CfnOutput, DockerImage, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventTargets from 'aws-cdk-lib/aws-events-targets'
import * as sfn from 'aws-cdk-lib/aws-stepfunctions'
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

export const SPA_REWRITE_PATH = fileURLToPath(new URL('./spa-rewrite.js', import.meta.url))
const BACKEND_DIR = fileURLToPath(new URL('../../backend', import.meta.url))
const PROCESSING_DIR = fileURLToPath(new URL('../../backend/processing', import.meta.url))

/** The two deployed environments in the one AWS account (ADR-0006). The local stack is a prod-shaped stack. */
export type Stage = 'stg' | 'prod'

/** SSM SecureString holding a stage's CloudFront signing private key (created by the setup wizard / local-up). */
export function signingKeyParam(stage: Stage): string {
  return `/viajecito/${stage}/cloudfront/signing-private-key`
}

export interface AlbumStackProps extends StackProps {
  /**
   * `prod` (default) keeps its data on deletion and owns the account's one budget. `stg` is a throwaway
   * environment: everything that holds data is destroyed with the stack, and it creates no budget.
   */
  stage?: Stage
  /** Email that receives the budget alerts (prod only; the budget covers the whole account). Given at deploy time, never committed. */
  budgetAlertEmail?: string
  /** PEM public key of the CloudFront signing key pair (the private half lives in SSM). */
  signingPublicKey?: string
  /** Extra browser origin allowed to upload to the photo bucket (the local SPA, never set in production). */
  localSpaOrigin?: string
  /**
   * The local stack (Floci). Only a local stack may go without a signing key; it also sets
   * MEDIA_COOKIE_RESOURCE to empty (Floci's CloudFront does not need a Resource in the cookie policy).
   */
  local?: boolean
}

/** Monthly cost limit in USD; the alarm emails at 80% actual and 100% forecast. */
export const MONTHLY_BUDGET_USD = 5

/** The whole Album: login, API, data and the site, behind one CloudFront distribution (ADR-0002). */
export class AlbumStack extends Stack {
  constructor(scope: Construct, id: string, props?: AlbumStackProps) {
    super(scope, id, props)
    const stage: Stage = props?.stage ?? 'prod'
    if (stage === 'stg' && props?.local) throw new Error('The local stack is prod-shaped: local: true cannot be combined with stage: stg')
    const throwaway = stage === 'stg'
    // Staging is rebuilt from scratch whenever wanted (`cdk destroy ViajecitoStg`); prod keeps its data.
    const dataRemoval = throwaway ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN
    const signingKeyParamName = signingKeyParam(stage)
    if (!props?.local && !props?.signingPublicKey) {
      throw new Error('AlbumStack needs signingPublicKey unless it is the local stack (local: true)')
    }

    // Login. Members are created by an admin (the setup wizard); nobody can sign up.
    const userPool = new cognito.UserPool(this, 'Members', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.NONE,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      deletionProtection: !throwaway,
      removalPolicy: dataRemoval,
    })
    const spaClient = userPool.addClient('Spa', {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.days(365),
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
    })

    // Data (ADR-0003). Item layout: backend/internal/store.
    const table = new dynamodb.Table(this, 'Album', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: dataRemoval,
    })
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    })

    // Photos (ADR-0002, ADR-0004): a private bucket. Browsers upload originals/ with presigned POSTs;
    // the processing workflow writes media/, which CloudFront serves to holders of signed cookies.
    const photoBucket = new s3.Bucket(this, 'Photos', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: true,
      eventBridgeEnabled: true,
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          // Kept as a wildcard on purpose. The exact origin is the distribution's own domain, but the
          // distribution needs this bucket (the /media/* origin and its OAC bucket policy), and the bucket's
          // CORS would then need the distribution: a CloudFormation dependency cycle. Breaking it takes a
          // custom resource or a second deploy, which costs more than it buys: this rule only allows a
          // browser from some CloudFront site to POST here, and the POST still needs a presigned policy
          // signed by the API for a Member, scoped to one key and content type.
          allowedOrigins: ['https://*.cloudfront.net', ...(props?.localSpaOrigin ? [props.localSpaOrigin] : [])],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      removalPolicy: dataRemoval,
      autoDeleteObjects: throwaway,
    })

    // Key group for signed cookies on /media/*. The private key never touches CDK: the setup
    // wizard keeps it in SSM Parameter Store (signingKeyParam(stage)).
    let publicKey: cloudfront.PublicKey | undefined
    let keyGroup: cloudfront.KeyGroup | undefined
    if (props?.signingPublicKey) {
      publicKey = new cloudfront.PublicKey(this, 'MediaSigningKey', { encodedKey: props.signingPublicKey })
      keyGroup = new cloudfront.KeyGroup(this, 'MediaKeyGroup', { items: [publicKey] })
    }

    // The Go API: one arm64 Lambda behind an HTTP API with a Cognito JWT authorizer.
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: goLambdaCode('./cmd/api'),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        PHOTO_BUCKET: photoBucket.bucketName,
        MEDIA_SIGNING_KEY_PARAM: signingKeyParamName,
        // Only the local stack may lack a key (the constructor throws otherwise).
        MEDIA_KEY_PAIR_ID: publicKey?.publicKeyId ?? 'not-configured',
        // Local stack only: set but empty tells the API to omit the cookie policy Resource (Floci).
        ...(props?.local && { MEDIA_COOKIE_RESOURCE: '' }),
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    })
    // Trips and Photos are created, edited and deleted by the API. Writes are on the table only,
    // so the indexes stay read-only. BatchWriteItem is for deleting a Trip's Photo records.
    table.grantReadData(apiFunction)
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem'],
        resources: [table.tableArn],
      }),
    )

    // Upload links: the API signs presigned POSTs with its own role, so it may only write originals/.
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [photoBucket.arnForObjects('originals/*')] }),
    )
    // Deleting a Photo or a Trip: the original and the web versions only. The bucket is versioned, so
    // a delete adds a delete marker and the originals stay recoverable until the lifecycle rule expires
    // them. No s3:DeleteObjectVersion (nothing is purged) and no read or list of the bucket.
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:DeleteObject'],
        resources: [photoBucket.arnForObjects('originals/*'), photoBucket.arnForObjects('media/*')],
      }),
    )
    // Media cookies: it reads the signing key (default aws/ssm key, so no kms grant is needed).
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: signingKeyParamName.slice(1) })],
      }),
    )

    // Photo processing (ADR-0004): bucket event -> Express workflow -> three Python Lambdas.
    const processingCode = pythonLambdaCode()
    const processingFunction = (id: string, handler: string, props2: { memory: number; seconds: number }) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.PYTHON_3_13,
        architecture: lambda.Architecture.ARM_64,
        handler: `viajecito_processing.handlers.${handler}`,
        code: processingCode,
        memorySize: props2.memory,
        timeout: Duration.seconds(props2.seconds),
        environment: { TABLE_NAME: table.tableName },
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      })
    const markProcessing = processingFunction('MarkProcessingFunction', 'mark_processing', { memory: 256, seconds: 10 })
    const processImage = processingFunction('ProcessImageFunction', 'process_image', { memory: 1024, seconds: 60 })
    const markReady = processingFunction('MarkReadyFunction', 'mark_ready', { memory: 256, seconds: 10 })
    const markFailed = processingFunction('MarkFailedFunction', 'mark_failed', { memory: 256, seconds: 10 })
    // Least privilege per step: no delete, no writes to originals/.
    for (const fn of [markProcessing, markReady, markFailed]) {
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [table.tableArn] }))
    }
    processImage.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [photoBucket.arnForObjects('originals/*')] }),
    )
    processImage.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [photoBucket.arnForObjects('media/*')] }),
    )

    const retryOnService = {
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    }
    // A handler exception (e.g. an S3 ClientError) or a Lambda timeout is retried with backoff as well.
    // UnreadableImage is listed first with no attempts: the first matching retrier wins, so it stays final.
    const retryOnHandlerError = {
      errors: ['States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    }
    const neverRetry = { errors: ['UnreadableImage'], maxAttempts: 0 }
    // Anything that goes wrong lands the Photo in `failed` (with a reason) instead of leaving it processing.
    // UnreadableImage is final: it goes to the Catch with no retry.
    // MarkFailed is the last line of defence: it retries longer (6 tries, 2 s doubling) so a Photo is
    // never left in `processing` by a transient Lambda error.
    const markFailedTask = new tasks.LambdaInvoke(this, 'MarkFailed', {
      lambdaFunction: markFailed,
      payloadResponseOnly: true,
      retryOnServiceExceptions: false, // the retriers below replace CDK's default one, in a known order
    })
      .addRetry(neverRetry)
      .addRetry({ ...retryOnService, maxAttempts: 6 })
      .addRetry({ ...retryOnHandlerError, maxAttempts: 6 })
      .next(new sfn.Succeed(this, 'PhotoFailed'))
    const invoke = (id: string, fn: lambda.IFunction) =>
      new tasks.LambdaInvoke(this, id, { lambdaFunction: fn, payloadResponseOnly: true, retryOnServiceExceptions: false })
        .addRetry(neverRetry)
        .addRetry(retryOnService)
        .addRetry(retryOnHandlerError)
        .addCatch(markFailedTask, { errors: ['States.ALL'], resultPath: '$.error' })
    const done = new sfn.Succeed(this, 'Done')
    const gone = new sfn.Succeed(this, 'PhotoGone')
    const definition = invoke('MarkProcessing', markProcessing).next(
      new sfn.Choice(this, 'Gone?')
        .when(sfn.Condition.booleanEquals('$.gone', true), gone)
        .otherwise(invoke('ProcessImage', processImage).next(invoke('MarkReady', markReady).next(done))),
    )
    const processingLogs = new logs.LogGroup(this, 'ProcessingWorkflowLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const processing = new sfn.StateMachine(this, 'ProcessPhoto', {
      stateMachineType: sfn.StateMachineType.EXPRESS,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(5),
      logs: { destination: processingLogs, level: sfn.LogLevel.ERROR },
    })
    // Retry (POST .../retry) starts the same workflow from the API, so the API needs the ARN and
    // StartExecution on this one state machine. Set after the machine exists: it does not depend on the API.
    apiFunction.addEnvironment('PROCESSING_STATE_MACHINE_ARN', processing.stateMachineArn)
    processing.grantStartExecution(apiFunction)
    // Match on bucket name and key prefix only: Floci's events carry no bucket ARN in `resources`.
    new events.Rule(this, 'OriginalUploaded', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: { bucket: { name: [photoBucket.bucketName] }, object: { key: [{ prefix: 'originals/' }] } },
      },
      targets: [
        new eventTargets.SfnStateMachine(processing, {
          input: events.RuleTargetInput.fromObject({
            bucket: events.EventField.fromPath('$.detail.bucket.name'),
            key: events.EventField.fromPath('$.detail.object.key'),
          }),
        }),
      ],
    })

    // userPoolProviderUrl is the pool's issuer (on AWS and on Floci alike), unlike
    // HttpUserPoolAuthorizer, which hardcodes the AWS issuer host.
    const authorizer = new HttpJwtAuthorizer('MemberJwt', userPool.userPoolProviderUrl, {
      jwtAudience: [spaClient.userPoolClientId],
    })
    const httpApi = new apigw.HttpApi(this, 'Api', {
      defaultAuthorizer: authorizer,
      createDefaultStage: false,
    })
    // Two Members need little; the limits keep a flood of requests from costing money.
    httpApi.addStage('DefaultStage', {
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 20, burstLimit: 40 },
    })
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigw.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFunction),
    })

    // The site: a private bucket behind CloudFront with origin access control.
    const siteBucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      removalPolicy: dataRemoval,
      autoDeleteObjects: throwaway,
    })
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({ filePath: SPA_REWRITE_PATH }),
      comment: 'Serve index.html for client routes (default behaviour only)',
    })
    const apiDomain = Fn.select(2, Fn.split('/', httpApi.apiEndpoint))

    // Tokens live in localStorage (Amplify), so a strict CSP is the main guard against XSS.
    const siteHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      comment: 'Viajecito security headers with a strict CSP',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            // The browser POSTs photos straight to the photo bucket with a presigned link.
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com https://${photoBucket.bucketName}.s3.${this.region}.amazonaws.com`,
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'self'",
            "object-src 'none'",
          ].join('; '),
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
    })

    // Photos are served as images only: stop browsers from sniffing them into something else.
    const mediaHeaders = new cloudfront.ResponseHeadersPolicy(this, 'MediaHeaders', {
      comment: 'Viajecito photo headers',
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        // CloudFront rejects security headers in customHeaders (Floci accepts them): use the dedicated field.
        contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'; sandbox", override: true },
      },
    })

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: siteHeaders,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards every viewer header except Host, Authorization included.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Photo web versions: only holders of the signed cookies (trusted key group) get through.
        ...(keyGroup && {
          '/media/*': {
            origin: origins.S3BucketOrigin.withOriginAccessControl(photoBucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            trustedKeyGroups: [keyGroup],
            responseHeadersPolicy: mediaHeaders,
          },
        }),
      },
    })

    if (keyGroup && publicKey) {
      new CfnOutput(this, 'MediaKeyGroupId', { value: keyGroup.keyGroupId })
      new CfnOutput(this, 'MediaPublicKeyId', { value: publicKey.publicKeyId })
    }

    // Cost guard: a few photos for two people should never cost real money.
    // AWS budgets measure the whole account, so prod creates the only one and it covers staging too.
    if (!throwaway && props?.budgetAlertEmail) {
      const subscribers = [{ subscriptionType: 'EMAIL', address: props.budgetAlertEmail }]
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'viajecito-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers,
          },
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers,
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers,
          },
        ],
      })
    }

    const out = (id: string, value: string) => new CfnOutput(this, id, { value })
    out('Stage', stage)
    out('UserPoolId', userPool.userPoolId)
    out('UserPoolClientId', spaClient.userPoolClientId)
    out('UserPoolProviderUrl', userPool.userPoolProviderUrl)
    out('ApiId', httpApi.apiId)
    out('ApiEndpoint', httpApi.apiEndpoint)
    out('ApiFunctionName', apiFunction.functionName)
    out('TableName', table.tableName)
    out('SiteBucketName', siteBucket.bucketName)
    out('PhotoBucketName', photoBucket.bucketName)
    out('ProcessingStateMachineArn', processing.stateMachineArn)
    out('MarkProcessingFunctionName', markProcessing.functionName)
    out('ProcessImageFunctionName', processImage.functionName)
    out('MarkReadyFunctionName', markReady.functionName)
    out('MarkFailedFunctionName', markFailed.functionName)
    out('DistributionId', distribution.distributionId)
    out('DistributionDomainName', distribution.distributionDomainName)
  }
}

/** Builds a Go command for linux/arm64 at synth time (locally if Go is installed, else in Docker). */
function goLambdaCode(pkg: string): lambda.Code {
  const env = { GOOS: 'linux', GOARCH: 'arm64', CGO_ENABLED: '0' }
  const buildArgs = ['build', '-trimpath', '-tags', 'lambda.norpc', '-ldflags', '-s -w']
  return lambda.Code.fromAsset(BACKEND_DIR, {
    exclude: ['**/*_test.go'],
    bundling: {
      image: DockerImage.fromRegistry('public.ecr.aws/docker/library/golang:1.26'),
      command: ['bash', '-c', `go ${buildArgs.map((a) => `'${a}'`).join(' ')} -o /asset-output/bootstrap ${pkg}`],
      environment: env,
      local: {
        tryBundle(outputDir: string) {
          try {
            execFileSync('go', ['version'], { stdio: 'ignore' })
          } catch {
            return false
          }
          execFileSync('go', [...buildArgs, '-o', `${outputDir}/bootstrap`, pkg], {
            cwd: BACKEND_DIR,
            env: { ...process.env, ...env },
            stdio: 'inherit',
          })
          return true
        },
      },
    },
  })
}

/**
 * The photo-processing zip: the src package plus aarch64 wheels (Pillow), built at synth time.
 * pip downloads the wheels for the target platform, so the host architecture does not matter and
 * no QEMU is needed here. Uses the local pip if present, else Docker.
 */
function pythonLambdaCode(): lambda.Code {
  const pipArgs = [
    'install', '-r', 'requirements.txt', '--only-binary=:all:', '--platform', 'manylinux_2_28_aarch64',
    '--implementation', 'cp', '--python-version', '3.13',
  ]
  return lambda.Code.fromAsset(PROCESSING_DIR, {
    exclude: ['.venv', 'tests', '**/__pycache__', '.mypy_cache', '.ruff_cache', '.pytest_cache', 'requirements-dev.txt'],
    bundling: {
      image: lambda.Runtime.PYTHON_3_13.bundlingImage,
      command: [
        'bash', '-c',
        `pip ${pipArgs.join(' ')} -t /asset-output && cp -r src/* /asset-output`,
      ],
      local: {
        tryBundle(outputDir: string) {
          try {
            execFileSync('python3', ['-m', 'pip', '--version'], { stdio: 'ignore' })
          } catch {
            return false
          }
          execFileSync('python3', ['-m', 'pip', ...pipArgs, '-t', outputDir, '--quiet'], { cwd: PROCESSING_DIR, stdio: 'inherit' })
          cpSync(`${PROCESSING_DIR}/src`, outputDir, { recursive: true, filter: (src) => !src.includes('__pycache__') })
          return true
        },
      },
    },
  })
}
