package lambdahttp_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/lambdahttp"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

// echo reports what the net/http handler received.
var echo = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Add("Set-Cookie", "a=1")
	w.Header().Add("Set-Cookie", "b=2")
	w.WriteHeader(http.StatusTeapot)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"method": r.Method,
		"path":   r.URL.Path,
		"query":  r.URL.RawQuery,
		"header": r.Header.Get("X-Thing"),
		"body":   string(body),
	})
})

func httpEvent(method, path string) events.APIGatewayV2HTTPRequest {
	return events.APIGatewayV2HTTPRequest{
		Version:  "2.0",
		RouteKey: method + " " + path,
		RawPath:  path,
		Headers:  map[string]string{"x-thing": "yes"},
		RequestContext: events.APIGatewayV2HTTPRequestContext{
			HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: method, Path: path},
		},
	}
}

func TestAdapterMapsRequestAndResponse(t *testing.T) {
	ev := httpEvent(http.MethodPost, "/api/things")
	ev.RawQueryString = "x=1&y=2"
	ev.Body = base64.StdEncoding.EncodeToString([]byte(`{"hi":true}`))
	ev.IsBase64Encoded = true
	ev.Cookies = []string{"c=3"}

	res, err := lambdahttp.Adapt(echo)(context.Background(), ev)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusTeapot {
		t.Errorf("status = %d", res.StatusCode)
	}
	if res.Headers["Content-Type"] != "application/json" {
		t.Errorf("headers = %v", res.Headers)
	}
	if len(res.Cookies) != 2 || res.Cookies[0] != "a=1" || res.Cookies[1] != "b=2" {
		t.Errorf("cookies = %v", res.Cookies)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(res.Body), &got); err != nil {
		t.Fatalf("body %q: %v", res.Body, err)
	}
	want := map[string]string{"method": "POST", "path": "/api/things", "query": "x=1&y=2", "header": "yes", "body": `{"hi":true}`}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestAdapterKeepsAnEncodedPathAsIs(t *testing.T) {
	var gotPath, gotRaw string
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotRaw = r.URL.Path, r.URL.EscapedPath()
	})
	ev := httpEvent(http.MethodGet, "/api/trips/a%20b%2Fc")
	if _, err := lambdahttp.Adapt(h)(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/trips/a b/c" || gotRaw != "/api/trips/a%20b%2Fc" {
		t.Errorf("path = %q, escaped = %q", gotPath, gotRaw)
	}
}

func TestAdapterBase64EncodesBinaryResponses(t *testing.T) {
	payload := []byte{0xff, 0xd8, 0xff, 0x00}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(payload)
	})
	res, err := lambdahttp.Adapt(h)(context.Background(), httpEvent(http.MethodGet, "/x"))
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsBase64Encoded || res.Body != base64.StdEncoding.EncodeToString(payload) {
		t.Errorf("got base64=%v body=%q", res.IsBase64Encoded, res.Body)
	}
}

func TestAdapterAnswersABadBase64BodyWith400(t *testing.T) {
	ev := httpEvent(http.MethodPost, "/x")
	ev.Body, ev.IsBase64Encoded = "%%%not-base64", true
	res, err := lambdahttp.Adapt(echo)(context.Background(), ev)
	if err != nil {
		t.Fatalf("err = %v, want a 400 response", err)
	}
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.StatusCode)
	}
}

type oneMember struct{ api.Store }

func (oneMember) GetMember(_ context.Context, id string) (store.Member, error) {
	if id == "sub-leo" {
		return store.Member{ID: id, DisplayName: "Leo"}, nil
	}
	return store.Member{}, store.ErrNotFound
}

func (oneMember) ListTrips(context.Context) ([]store.Trip, error) { return nil, nil }

// noDeps stands in for collaborators this test never reaches.
type noDeps struct{}

func (noDeps) PresignUpload(context.Context, string, string, int64) (media.Upload, error) {
	return media.Upload{}, nil
}
func (noDeps) Cookies(context.Context, time.Time) ([]*http.Cookie, error) { return nil, nil }
func (noDeps) StartProcessing(context.Context, string) error              { return nil }
func (noDeps) DeleteObjects(context.Context, []string) error              { return nil }

func TestAdapterForwardsJWTClaimsToTheAPI(t *testing.T) {
	h := lambdahttp.Adapt(api.NewServer(api.Deps{Store: oneMember{}, Uploads: noDeps{}, Objects: noDeps{}, Cookies: noDeps{}, Workflow: noDeps{}}))

	ev := httpEvent(http.MethodGet, "/api/me")
	ev.RequestContext.Authorizer = &events.APIGatewayV2HTTPRequestContextAuthorizerDescription{
		JWT: &events.APIGatewayV2HTTPRequestContextAuthorizerJWTDescription{
			Claims: map[string]string{"sub": "sub-leo", "token_use": "access"},
		},
	}
	res, err := h(context.Background(), ev)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || res.Body == "" {
		t.Fatalf("got %d %q", res.StatusCode, res.Body)
	}
	var me map[string]string
	_ = json.Unmarshal([]byte(res.Body), &me)
	if me["id"] != "sub-leo" || me["displayName"] != "Leo" {
		t.Errorf("me = %v", me)
	}

	t.Run("an event without an authorizer gets 401", func(t *testing.T) {
		res, err := h(context.Background(), httpEvent(http.MethodGet, "/api/me"))
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", res.StatusCode)
		}
	})
}
