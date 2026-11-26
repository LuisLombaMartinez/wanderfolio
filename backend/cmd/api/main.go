// Command api is the Album's Go API, run as one Lambda behind API Gateway HTTP API.
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/lambdahttp"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/processing"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))

	table := mustEnv("TABLE_NAME")
	bucket := mustEnv("PHOTO_BUCKET")
	machineARN := mustEnv("PROCESSING_STATE_MACHINE_ARN")
	keyParam := mustEnv("MEDIA_SIGNING_KEY_PARAM")
	keyPairID := mustEnv("MEDIA_KEY_PAIR_ID")
	// MEDIA_COOKIE_RESOURCE only overrides the default policy Resource (media.DefaultCookieResource);
	// set to empty, it omits the Resource (the local stack needs that).
	envResource, resourceSet := os.LookupEnv("MEDIA_COOKIE_RESOURCE")
	cookieResource := media.CookieResource(envResource, resourceSet)
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("load aws config", "err", err)
		os.Exit(1)
	}
	signer := media.NewSigner(keyPairID, cookieResource, media.SSMKeyLoader(ssm.NewFromConfig(cfg), keyParam))
	s3Client := s3.NewFromConfig(cfg)
	lambda.Start(lambdahttp.Adapt(api.NewServer(api.Deps{
		Store:    store.New(dynamodb.NewFromConfig(cfg), table),
		Uploads:  media.NewUploader(s3Client, bucket),
		Objects:  media.NewObjects(s3Client, bucket),
		Cookies:  signer,
		Workflow: processing.NewStarter(sfn.NewFromConfig(cfg), machineARN, bucket),
	})))
}

func mustEnv(name string) string {
	v := os.Getenv(name)
	if v == "" {
		slog.Error("environment variable is not set", "name", name)
		os.Exit(1)
	}
	return v
}
