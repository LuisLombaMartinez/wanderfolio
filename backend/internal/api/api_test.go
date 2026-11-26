package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/claims"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/testenv"
)

// testSubHeader is read only by the test wrapper below: it stands in for the JWT
// that API Gateway validates, and becomes the claims API Gateway would forward.
const testSubHeader = "X-Test-Member-Sub"

type fixture struct {
	server *httptest.Server
	store  *store.Store
	media  testenv.Media
	clock  *testClock
	wf     *fakeWorkflow
}

// fakeWorkflow stands in for Step Functions: it records the originals it was asked to process.
type fakeWorkflow struct {
	mu   sync.Mutex
	keys []string
	err  error
	// hold, when set, makes StartProcessing signal on entered and block until its context ends.
	hold    bool
	entered chan struct{}
}

func (w *fakeWorkflow) StartProcessing(ctx context.Context, key string) error {
	w.mu.Lock()
	if w.hold {
		w.mu.Unlock()
		w.entered <- struct{}{}
		<-ctx.Done()
		return ctx.Err()
	}
	defer w.mu.Unlock()
	if w.err != nil {
		return w.err
	}
	w.keys = append(w.keys, key)
	return nil
}

func (w *fakeWorkflow) started() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]string(nil), w.keys...)
}

// testClock is the one clock the API and the store share, so tests can move past a TTL.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	return newFixtureWith(t, time.Now(), nil)
}

// newFixtureWith starts the clock at start and, if wrap is not nil, lets a test wrap the Uploads.
func newFixtureWith(t *testing.T, start time.Time, wrap func(api.Uploads) api.Uploads) fixture {
	t.Helper()
	clock := &testClock{t: start}
	st := testenv.NewStore(t, store.WithClock(clock.Now))
	md := testenv.NewMedia(t)
	var uploads api.Uploads = md.Uploader
	if wrap != nil {
		uploads = wrap(uploads)
	}
	wf := &fakeWorkflow{}
	h := api.NewServer(api.Deps{Store: st, Uploads: uploads, Objects: md.Objects, Cookies: md.Signer, Workflow: wf, Now: clock.Now})
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sub := r.Header.Get(testSubHeader); sub != "" {
			r = r.WithContext(claims.With(r.Context(), map[string]string{
				"sub":       sub,
				"token_use": "access",
			}))
		}
		h.ServeHTTP(w, r)
	})
	srv := httptest.NewServer(wrapped)
	t.Cleanup(srv.Close)
	return fixture{server: srv, store: st, media: md, clock: clock, wf: wf}
}

func (f fixture) addMember(t *testing.T, id, name string) {
	t.Helper()
	if err := f.store.PutMember(context.Background(), store.Member{ID: id, DisplayName: name}); err != nil {
		t.Fatalf("put member: %v", err)
	}
}

// get sends a GET as the given Member (empty sub = no claims, as if the authorizer were missing).
func (f fixture) get(t *testing.T, sub, path string) (int, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, f.server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if sub != "" {
		req.Header.Set(testSubHeader, sub)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return res.StatusCode, body
}

func errorCode(body map[string]any) string {
	e, _ := body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func TestCurrentMember(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")

	t.Run("returns the calling Member's id and display name", func(t *testing.T) {
		for _, tc := range []struct{ sub, name string }{{"sub-leo", "Leo"}, {"sub-ana", "Ana"}} {
			status, body := f.get(t, tc.sub, "/api/me")
			if status != http.StatusOK {
				t.Fatalf("status = %d, body %v", status, body)
			}
			if body["id"] != tc.sub || body["displayName"] != tc.name {
				t.Errorf("body = %v, want id %q displayName %q", body, tc.sub, tc.name)
			}
		}
	})

	t.Run("without forwarded claims it is unauthorized", func(t *testing.T) {
		status, body := f.get(t, "", "/api/me")
		if status != http.StatusUnauthorized || errorCode(body) != "unauthorized" {
			t.Errorf("got %d %v, want 401 unauthorized", status, body)
		}
	})

	t.Run("a valid login with no Member record is forbidden", func(t *testing.T) {
		status, body := f.get(t, "sub-stranger", "/api/me")
		if status != http.StatusForbidden || errorCode(body) != "not-a-member" {
			t.Errorf("got %d %v, want 403 not-a-member", status, body)
		}
	})
}

func TestTripListing(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")

	t.Run("an empty Album lists no Trips", func(t *testing.T) {
		status, body := f.get(t, "sub-leo", "/api/trips")
		if status != http.StatusOK {
			t.Fatalf("status = %d, body %v", status, body)
		}
		trips, ok := body["trips"].([]any)
		if !ok || len(trips) != 0 {
			t.Errorf("trips = %#v, want an empty JSON array", body["trips"])
		}
	})

	t.Run("requires a Member", func(t *testing.T) {
		status, body := f.get(t, "sub-stranger", "/api/trips")
		if status != http.StatusForbidden || errorCode(body) != "not-a-member" {
			t.Errorf("got %d %v, want 403 not-a-member", status, body)
		}
	})
}

func TestUnknownRoute(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	status, body := f.get(t, "sub-leo", "/api/nope")
	if status != http.StatusNotFound || errorCode(body) != "not-found" {
		t.Errorf("got %d %v, want 404 not-found", status, body)
	}
}
