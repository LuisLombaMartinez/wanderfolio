package media_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
)

func TestDefaultCookiePolicyResource(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	load := func(context.Context) (*rsa.PrivateKey, error) { return key, nil }
	policyOf := func(resource string) map[string]any {
		cookies, err := media.NewSigner("K1", resource, load).Cookies(context.Background(), time.Unix(1800000000, 0))
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range cookies {
			if c.Name == "CloudFront-Policy" {
				raw, err := base64.StdEncoding.DecodeString(strings.NewReplacer("-", "+", "_", "=", "~", "/").Replace(c.Value))
				if err != nil {
					t.Fatal(err)
				}
				var p map[string]any
				if err := json.Unmarshal(raw, &p); err != nil {
					t.Fatal(err)
				}
				return p["Statement"].([]any)[0].(map[string]any)
			}
		}
		t.Fatal("no policy cookie")
		return nil
	}

	if got := policyOf(media.CookieResource("", false))["Resource"]; got != "https://*/media/*" {
		t.Errorf("default Resource = %v, want https://*/media/*", got)
	}
	if got := policyOf(media.CookieResource("https://x.example/media/*", true))["Resource"]; got != "https://x.example/media/*" {
		t.Errorf("overridden Resource = %v", got)
	}
	if got, ok := policyOf(media.CookieResource("", true))["Resource"]; ok {
		t.Errorf("an empty override should omit the Resource, got %v", got)
	}
	st := policyOf(media.DefaultCookieResource)
	if exp := st["Condition"].(map[string]any)["DateLessThan"].(map[string]any)["AWS:EpochTime"]; exp != float64(1800000000) {
		t.Errorf("expiry = %v", exp)
	}
}

func TestPresignPolicyConditions(t *testing.T) {
	client := s3.New(s3.Options{
		Region: "eu-west-1", Credentials: credentials.NewStaticCredentialsProvider("a", "b", ""),
	})
	up, err := media.NewUploader(client, "bucket").PresignUpload(context.Background(), "originals/t/p", "image/jpeg", 30<<20)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(up.Fields["policy"])
	if err != nil {
		t.Fatalf("policy field: %v", err)
	}
	var policy struct {
		Expiration string `json:"expiration"`
		Conditions []any  `json:"conditions"`
	}
	if err := json.Unmarshal(raw, &policy); err != nil {
		t.Fatal(err)
	}
	var haveRange, haveType, haveKey, haveBucket bool
	for _, c := range policy.Conditions {
		switch c := c.(type) {
		case []any:
			if len(c) == 3 && c[0] == "content-length-range" && c[1] == float64(1) && c[2] == float64(30<<20) {
				haveRange = true
			}
		case map[string]any:
			haveType = haveType || c["Content-Type"] == "image/jpeg"
			haveKey = haveKey || c["key"] == "originals/t/p"
			haveBucket = haveBucket || c["bucket"] == "bucket"
		}
	}
	if !haveRange || !haveType || !haveKey || !haveBucket {
		t.Errorf("conditions missing (range=%v type=%v key=%v bucket=%v): %s", haveRange, haveType, haveKey, haveBucket, raw)
	}
	exp, err := time.Parse("2006-01-02T15:04:05Z", policy.Expiration)
	if err != nil {
		t.Fatalf("expiration %q: %v", policy.Expiration, err)
	}
	if d := time.Until(exp); d > media.LinkTTL+time.Minute || d < media.LinkTTL-time.Minute {
		t.Errorf("link lifetime = %v, want about %v", d, media.LinkTTL)
	}
}
