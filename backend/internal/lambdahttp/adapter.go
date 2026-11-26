// Package lambdahttp runs a net/http handler behind API Gateway HTTP API
// (payload format 2.0) in Lambda, so the API stays a plain net/http server (ADR-0002).
package lambdahttp

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/aws/aws-lambda-go/events"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/claims"
)

// Handler is a Lambda handler for HTTP API events.
type Handler func(context.Context, events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error)

// Adapt turns h into a Lambda handler. The JWT claims API Gateway's authorizer
// verified are put into the request context (see package claims).
func Adapt(h http.Handler) Handler {
	return func(ctx context.Context, ev events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
		req, err := toRequest(ctx, ev)
		if err != nil {
			return events.APIGatewayV2HTTPResponse{
				StatusCode: http.StatusBadRequest,
				Headers:    map[string]string{"Content-Type": "application/json"},
				Body:       `{"error":{"code":"bad-request","message":"malformed request"}}`,
			}, nil
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return toResponse(rec), nil
	}
}

func toRequest(ctx context.Context, ev events.APIGatewayV2HTTPRequest) (*http.Request, error) {
	if a := ev.RequestContext.Authorizer; a != nil && a.JWT != nil && len(a.JWT.Claims) > 0 {
		ctx = claims.With(ctx, a.JWT.Claims)
	}

	body := []byte(ev.Body)
	if ev.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(ev.Body)
		if err != nil {
			return nil, fmt.Errorf("decode body: %w", err)
		}
		body = decoded
	}

	// RawPath is already percent-encoded: parse it as such so it is not escaped twice.
	target := ev.RawPath
	if ev.RawQueryString != "" {
		target += "?" + ev.RawQueryString
	}
	u, err := url.ParseRequestURI(target)
	if err != nil {
		return nil, fmt.Errorf("parse path: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, ev.RequestContext.HTTP.Method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	for k, v := range ev.Headers {
		req.Header.Set(k, v)
	}
	if len(ev.Cookies) > 0 {
		req.Header.Set("Cookie", strings.Join(ev.Cookies, "; "))
	}
	req.Host = ev.RequestContext.DomainName
	req.RemoteAddr = ev.RequestContext.HTTP.SourceIP
	return req, nil
}

func toResponse(rec *httptest.ResponseRecorder) events.APIGatewayV2HTTPResponse {
	res := events.APIGatewayV2HTTPResponse{
		StatusCode: rec.Code,
		Headers:    map[string]string{},
	}
	if isText(rec.Header().Get("Content-Type")) {
		res.Body = rec.Body.String()
	} else {
		res.Body = base64.StdEncoding.EncodeToString(rec.Body.Bytes())
		res.IsBase64Encoded = true
	}
	for k, vs := range rec.Header() {
		if http.CanonicalHeaderKey(k) == "Set-Cookie" {
			res.Cookies = append(res.Cookies, vs...)
			continue
		}
		res.Headers[k] = strings.Join(vs, ",")
	}
	return res
}

// isText reports whether a response body can travel to API Gateway as a plain string.
func isText(contentType string) bool {
	mt, _, err := mime.ParseMediaType(contentType)
	if contentType == "" || err != nil {
		return contentType == ""
	}
	return strings.HasPrefix(mt, "text/") || mt == "application/json" || strings.HasSuffix(mt, "+json")
}
