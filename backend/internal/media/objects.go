package media

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"golang.org/x/sync/errgroup"
)

const (
	deleteObjectsMax   = 1000 // S3's limit per DeleteObjects
	deleteObjectsLanes = 4
)

// Objects deletes objects of the photo bucket. The bucket is versioned, so a delete leaves a
// delete marker and the earlier versions stay recoverable until the lifecycle rule expires them.
type Objects struct {
	client *s3.Client
	bucket string
}

// NewObjects returns Objects for the given bucket.
func NewObjects(client *s3.Client, bucket string) *Objects {
	return &Objects{client: client, bucket: bucket}
}

// DeleteObjects deletes the keys in batches of 1000, a few batches at once. Keys that do not
// exist are fine; any key S3 refuses to delete is an error.
func (o *Objects) DeleteObjects(ctx context.Context, keys []string) error {
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(deleteObjectsLanes)
	for start := 0; start < len(keys); start += deleteObjectsMax {
		batch := keys[start:min(start+deleteObjectsMax, len(keys))]
		g.Go(func() error { return o.deleteBatch(gctx, batch) })
	}
	return g.Wait()
}

func (o *Objects) deleteBatch(ctx context.Context, keys []string) error {
	ids := make([]types.ObjectIdentifier, len(keys))
	for i, k := range keys {
		ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
	}
	out, err := o.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: &o.bucket,
		Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
	})
	if err != nil {
		return fmt.Errorf("delete objects: %w", err)
	}
	if len(out.Errors) > 0 {
		e := out.Errors[0]
		return fmt.Errorf("delete objects: %d refused, first %s: %s", len(out.Errors), aws.ToString(e.Key), aws.ToString(e.Code))
	}
	return nil
}
