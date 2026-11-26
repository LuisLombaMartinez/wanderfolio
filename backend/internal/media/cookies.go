package media

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec // CloudFront signed cookies are RSA-SHA1.
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// KeyLoader returns the CloudFront signing key.
type KeyLoader func(ctx context.Context) (*rsa.PrivateKey, error)

// SSMKeyLoader reads a PEM private key (PKCS#1 or PKCS#8) from an SSM SecureString.
func SSMKeyLoader(client *ssm.Client, name string) KeyLoader {
	return func(ctx context.Context) (*rsa.PrivateKey, error) {
		out, err := client.GetParameter(ctx, &ssm.GetParameterInput{Name: &name, WithDecryption: ptr(true)})
		if err != nil {
			return nil, fmt.Errorf("get signing key parameter: %w", err)
		}
		if out.Parameter == nil || out.Parameter.Value == nil {
			return nil, errors.New("signing key parameter is empty")
		}
		return ParsePrivateKey([]byte(*out.Parameter.Value))
	}
}

func ptr[T any](v T) *T { return &v }

// ParsePrivateKey decodes an RSA private key in PEM form.
func ParsePrivateKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("signing key is not PEM")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse signing key: %w", err)
	}
	rk, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("signing key is not RSA")
	}
	return rk, nil
}

// CookiePath is the only path the signed cookies are sent to.
const CookiePath = "/media"

// Signer issues CloudFront signed cookies for /media/*.
type Signer struct {
	keyPairID string
	resource  string
	load      KeyLoader

	mu  sync.Mutex
	key *rsa.PrivateKey
}

// DefaultCookieResource is the policy Resource of the media cookies unless overridden: any
// host, only under /media/. The local stack (Floci) cannot match it and overrides it with "".
const DefaultCookieResource = "https://*/media/*"

// CookieResource resolves the policy Resource from an environment value: the default when
// the variable is unset, the value itself (possibly empty, meaning no Resource) when set.
func CookieResource(value string, set bool) string {
	if !set {
		return DefaultCookieResource
	}
	return value
}

// NewSigner returns a Signer. keyPairID is the id of the CloudFront public key in the
// distribution's trusted key group. resource is the policy's Resource pattern; leave it
// empty to omit it, which lets the cookies open any distribution that trusts the key.
func NewSigner(keyPairID, resource string, load KeyLoader) *Signer {
	return &Signer{keyPairID: keyPairID, resource: resource, load: load}
}

func (s *Signer) privateKey(ctx context.Context) (*rsa.PrivateKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key != nil {
		return s.key, nil
	}
	k, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	s.key = k
	return k, nil
}

type policy struct {
	Statement []statement `json:"Statement"`
}

type statement struct {
	Resource  string `json:"Resource,omitempty"`
	Condition struct {
		DateLessThan struct {
			EpochTime int64 `json:"AWS:EpochTime"`
		} `json:"DateLessThan"`
	} `json:"Condition"`
}

// Cookies returns the three CloudFront cookies, valid until expires.
func (s *Signer) Cookies(ctx context.Context, expires time.Time) ([]*http.Cookie, error) {
	key, err := s.privateKey(ctx)
	if err != nil {
		return nil, err
	}
	var st statement
	st.Resource = s.resource
	st.Condition.DateLessThan.EpochTime = expires.Unix()
	policyJSON, err := json.Marshal(policy{Statement: []statement{st}})
	if err != nil {
		return nil, fmt.Errorf("marshal policy: %w", err)
	}
	digest := sha1.Sum(policyJSON) //nolint:gosec // see import
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA1, digest[:])
	if err != nil {
		return nil, fmt.Errorf("sign policy: %w", err)
	}
	values := [][2]string{
		{"CloudFront-Policy", cfBase64(policyJSON)},
		{"CloudFront-Signature", cfBase64(sig)},
		{"CloudFront-Key-Pair-Id", s.keyPairID},
	}
	cookies := make([]*http.Cookie, 0, len(values))
	for _, v := range values {
		cookies = append(cookies, &http.Cookie{
			Name: v[0], Value: v[1], Path: CookiePath, Expires: expires.UTC(),
			Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
	}
	return cookies, nil
}

// cfBase64 is base64 with CloudFront's URL-safe substitutions.
func cfBase64(b []byte) string {
	return strings.NewReplacer("+", "-", "=", "_", "/", "~").Replace(base64.StdEncoding.EncodeToString(b))
}
