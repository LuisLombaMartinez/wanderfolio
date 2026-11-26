// Package media talks to the photo bucket and CloudFront: presigned upload links and the
// signed cookies that unlock /media/*.
package media

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Upload is a presigned S3 POST: the browser sends a multipart form to URL with Fields
// first, then the file as the last part named "file".
type Upload struct {
	URL    string            `json:"url"`
	Fields map[string]string `json:"fields"`
}

// LinkTTL is how long an upload link stays valid.
const LinkTTL = 15 * time.Minute

// Uploader issues presigned POSTs to the photo bucket.
type Uploader struct {
	presign *s3.PresignClient
	bucket  string
}

// NewUploader returns an Uploader for the given bucket.
func NewUploader(client *s3.Client, bucket string) *Uploader {
	return &Uploader{presign: s3.NewPresignClient(client), bucket: bucket}
}

// PresignUpload returns a POST that S3 accepts only for exactly this key and content type
// and for a body of 1 byte up to maxBytes.
func (u *Uploader) PresignUpload(ctx context.Context, key, contentType string, maxBytes int64) (Upload, error) {
	out, err := u.presign.PresignPostObject(ctx, &s3.PutObjectInput{
		Bucket: &u.bucket,
		Key:    &key,
	}, func(o *s3.PresignPostOptions) {
		o.Expires = LinkTTL
		o.Conditions = []any{
			[]any{"content-length-range", 1, maxBytes},
			map[string]string{"Content-Type": contentType},
		}
	})
	if err != nil {
		return Upload{}, fmt.Errorf("presign post: %w", err)
	}
	fields := make(map[string]string, len(out.Values)+1)
	for k, v := range out.Values {
		fields[k] = v
	}
	// The SDK leaves Content-Type out of the form fields although the policy pins it.
	fields["Content-Type"] = contentType
	return Upload{URL: out.URL, Fields: fields}, nil
}
