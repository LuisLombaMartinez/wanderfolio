// Package testenv gives tests a fresh DynamoDB table on the local Floci stack.
//
// Tests need AWS_ENDPOINT_URL pointing at Floci (for example http://localhost:4600);
// without it they fail (never skip: a silent skip once hid a regression), so a plain `go test` never touches real AWS.
package testenv

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	ssmtypes "github.com/aws/aws-sdk-go-v2/service/ssm/types"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

// NewStore creates an empty table shaped like the one in infra/ and returns a Store on it.
func NewStore(t *testing.T, opts ...store.Option) *store.Store {
	t.Helper()
	if os.Getenv("AWS_ENDPOINT_URL") == "" {
		t.Fatal("AWS_ENDPOINT_URL is not set; start Floci (infra/scripts/local-up.sh) and export it")
	}
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	t.Setenv("AWS_REGION", "eu-west-1")

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		t.Fatalf("aws config: %v", err)
	}
	db := dynamodb.NewFromConfig(cfg)
	name := fmt.Sprintf("test-%s-%d", sanitize(t.Name()), time.Now().UnixNano())

	_, err = db.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:   aws.String(name),
		BillingMode: types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String("pk"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("sk"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("gsi1pk"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("gsi1sk"), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String("pk"), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String("sk"), KeyType: types.KeyTypeRange},
		},
		GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{{
			IndexName: aws.String(store.AlbumIndex),
			KeySchema: []types.KeySchemaElement{
				{AttributeName: aws.String("gsi1pk"), KeyType: types.KeyTypeHash},
				{AttributeName: aws.String("gsi1sk"), KeyType: types.KeyTypeRange},
			},
			Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll},
		}},
	})
	if err != nil {
		t.Fatalf("create table %s: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = db.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{TableName: aws.String(name)})
	})
	return store.New(db, name, opts...)
}

func sanitize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			out = append(out, r)
		default:
			out = append(out, '-')
		}
	}
	if len(out) > 100 {
		out = out[:100]
	}
	return string(out)
}

// Media is a photo bucket and a CloudFront signing key on the local stack.
type Media struct {
	Bucket    string
	S3        *s3.Client
	Uploader  *media.Uploader
	Objects   *media.Objects
	Signer    *media.Signer
	PublicKey *rsa.PublicKey
	KeyPairID string
}

// NewMedia creates an empty photo bucket and stores a fresh RSA signing key in SSM, the way
// the deployed stack has them.
func NewMedia(t *testing.T) Media {
	t.Helper()
	if os.Getenv("AWS_ENDPOINT_URL") == "" {
		t.Fatal("AWS_ENDPOINT_URL is not set; start Floci (infra/scripts/local-up.sh) and export it")
	}
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	t.Setenv("AWS_REGION", "eu-west-1")
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		t.Fatalf("aws config: %v", err)
	}
	// Floci's endpoint here is plain "localhost", which has no wildcard DNS: admin calls go path-style.
	// The Uploader gets the default (virtual-hosted) client the Lambda has; tests dial its links themselves.
	client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	bucket := fmt.Sprintf("test-%d", time.Now().UnixNano())
	if _, err := client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket:                    aws.String(bucket),
		CreateBucketConfiguration: &s3types.CreateBucketConfiguration{LocationConstraint: s3types.BucketLocationConstraintEuWest1},
	}); err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	param := "/test/" + bucket + "/signing-key"
	ssmc := ssm.NewFromConfig(cfg)
	if _, err := ssmc.PutParameter(ctx, &ssm.PutParameterInput{
		Name:  aws.String(param),
		Type:  ssmtypes.ParameterTypeSecureString,
		Value: aws.String(string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))),
	}); err != nil {
		t.Fatalf("put signing key: %v", err)
	}
	const keyPairID = "KTESTKEYPAIR"
	return Media{
		Bucket: bucket, S3: client, Uploader: media.NewUploader(s3.NewFromConfig(cfg), bucket),
		Objects:   media.NewObjects(client, bucket),
		Signer:    media.NewSigner(keyPairID, "", media.SSMKeyLoader(ssmc, param)),
		PublicKey: &key.PublicKey, KeyPairID: keyPairID,
	}
}
