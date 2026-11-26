package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// tripRoute is one Trip-scoped route a Member can call. Every such route must keep a Trip hidden
// by a Pending Invitation looking like a Trip that does not exist (#65).
type tripRoute struct {
	pattern string // as registered in api.go, e.g. "PUT /api/trips/{id}/cover-photo"
	path    func(tripID, ready, failed string) string
	payload func(ready, failed string) any
	ok      int // status when the Member can see the Trip
}

func tripPath(tripID, _, _ string) string { return "/api/trips/" + tripID }

// tripRoutes is the one place that lists the Trip-scoped routes. TestEveryTripRouteHasTheVisibilityRule
// fails when api.go registers a route with {id} that is neither here nor in visibilityExempt.
var tripRoutes = []tripRoute{
	{"GET /api/trips/{id}", tripPath, func(_, _ string) any { return nil }, http.StatusOK},
	{"PUT /api/trips/{id}", tripPath, func(_, _ string) any { return trip("Cambiado", "2027-03-01", "2027-03-05") }, http.StatusOK},
	{"DELETE /api/trips/{id}", tripPath, func(_, _ string) any { return nil }, http.StatusNoContent},
	{"POST /api/trips/{id}/photos/upload-links",
		func(id, _, _ string) string { return "/api/trips/" + id + "/photos/upload-links" },
		func(_, _ string) any { return map[string]any{"files": []file{jpeg("n.jpg", 10)}} }, http.StatusOK},
	{"PUT /api/trips/{id}/cover-photo",
		func(id, _, _ string) string { return "/api/trips/" + id + "/cover-photo" },
		func(ready, _ string) any { return map[string]any{"photoId": ready} }, http.StatusOK},
	{"POST /api/trips/{id}/photos/{photoId}/retry",
		func(id, _, failed string) string { return "/api/trips/" + id + "/photos/" + failed + "/retry" },
		func(_, _ string) any { return nil }, http.StatusOK},
	{"PATCH /api/trips/{id}/photos/{photoId}",
		func(id, ready, _ string) string { return "/api/trips/" + id + "/photos/" + ready },
		func(_, _ string) any { return map[string]any{"caption": "Atardecer"} }, http.StatusOK},
	{"DELETE /api/trips/{id}/photos/{photoId}",
		func(id, ready, _ string) string { return "/api/trips/" + id + "/photos/" + ready },
		func(_, _ string) any { return nil }, http.StatusNoContent},
}

// visibilityExempt are Trip-scoped routes that are meant to work for the Invitee while the Trip
// is hidden. Accepting is covered by TestAcceptInvitation.
var visibilityExempt = []string{"POST /api/trips/{id}/invitation/accept"}

func (r tripRoute) call(t *testing.T, f fixture, sub, tripID, ready, failed string) (int, map[string]any) {
	t.Helper()
	method := strings.Fields(r.pattern)[0]
	return f.send(t, method, sub, r.path(tripID, ready, failed), r.payload(ready, failed))
}

// raw is one response with its headers, for comparing a hidden Trip with a missing one.
type raw struct {
	status int
	body   string
	header http.Header
}

func (r tripRoute) callRaw(t *testing.T, f fixture, sub, tripID, ready, failed string) raw {
	t.Helper()
	var reader io.Reader
	if p := r.payload(ready, failed); p != nil {
		b, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(strings.Fields(r.pattern)[0], f.server.URL+r.path(tripID, ready, failed), reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(testSubHeader, sub)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return raw{res.StatusCode, string(body), res.Header}
}

// invitedTrip is a Trip with a Pending Invitation for Ana, one ready and one failed Photo.
func invitedTrip(t *testing.T, f fixture) (tripID, ready, failed string) {
	t.Helper()
	tripID = f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	ready = f.readyPhotos(t, tripID, "2026-11-05T10:00:00Z")[0]
	failed = f.readyPhotos(t, tripID, "")[0] // awaiting upload, then processing, then failed
	ctx := context.Background()
	if err := f.store.MarkPhotoProcessing(ctx, tripID, failed); err != nil {
		t.Fatalf("mark processing: %v", err)
	}
	if err := f.store.MarkPhotoFailed(ctx, tripID, failed, "corrupt image"); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	return tripID, ready, failed
}

func TestVisibilityRuleCoversEveryTripRoute(t *testing.T) {
	f := newInvitationFixture(t)
	missing := strings.Repeat("a", 32)

	for _, rt := range tripRoutes {
		t.Run(rt.pattern, func(t *testing.T) {
			t.Run("the Invitee of a Pending Invitation gets the nonexistent-Trip response", func(t *testing.T) {
				id, ready, failed := invitedTrip(t, f)
				_, before := f.get(t, "sub-leo", "/api/trips/"+id)
				ctx := context.Background()
				readyBefore, err := f.store.GetPhoto(ctx, id, ready)
				if err != nil {
					t.Fatal(err)
				}
				failedBefore, err := f.store.GetPhoto(ctx, id, failed)
				if err != nil {
					t.Fatal(err)
				}
				status, got := rt.call(t, f, "sub-ana", id, ready, failed)
				mStatus, miss := rt.call(t, f, "sub-ana", missing, ready, failed)
				if status != http.StatusNotFound {
					t.Errorf("hidden: %d %v, want 404", status, got)
				}
				if status != mStatus || !reflect.DeepEqual(got, miss) {
					t.Errorf("hidden %d %v differs from missing %d %v", status, got, mStatus, miss)
				}
				hidden, gone := rt.callRaw(t, f, "sub-ana", id, ready, failed), rt.callRaw(t, f, "sub-ana", missing, ready, failed)
				for _, h := range []string{"Content-Type", "Cache-Control", "Content-Length", "Vary", "Set-Cookie"} {
					if !reflect.DeepEqual(hidden.header.Values(h), gone.header.Values(h)) {
						t.Errorf("header %s: hidden %v, missing %v", h, hidden.header.Values(h), gone.header.Values(h))
					}
				}
				if hidden.status != gone.status || hidden.body != gone.body {
					t.Errorf("raw hidden %d %q differs from missing %d %q", hidden.status, hidden.body, gone.status, gone.body)
				}
				if got, err := f.store.GetPhoto(ctx, id, ready); err != nil || !reflect.DeepEqual(got, readyBefore) {
					t.Errorf("the ready Photo changed: %v -> %v (%v)", readyBefore, got, err)
				}
				if got, err := f.store.GetPhoto(ctx, id, failed); err != nil || !reflect.DeepEqual(got, failedBefore) {
					t.Errorf("the failed Photo changed: %v -> %v (%v)", failedBefore, got, err)
				}
				if _, after := f.get(t, "sub-leo", "/api/trips/"+id); !reflect.DeepEqual(before, after) {
					t.Errorf("the Trip changed:\nbefore %v\nafter  %v", before, after)
				}
			})
			t.Run("the Inviter keeps working", func(t *testing.T) {
				id, ready, failed := invitedTrip(t, f)
				if status, body := rt.call(t, f, "sub-leo", id, ready, failed); status != rt.ok {
					t.Errorf("Inviter: %d %v, want %d", status, body, rt.ok)
				}
			})
			t.Run("after Accept the Invitee can use it", func(t *testing.T) {
				id, ready, failed := invitedTrip(t, f)
				if status, body := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil); status != http.StatusOK {
					t.Fatalf("accept: %d %v", status, body)
				}
				if status, body := rt.call(t, f, "sub-ana", id, ready, failed); status != rt.ok {
					t.Errorf("Invitee after Accept: %d %v, want %d", status, body, rt.ok)
				}
			})
		})
	}
}

// A new Trip-scoped route that nobody added to tripRoutes would skip the table above, and a
// renamed or removed one would leave a stale entry. Both directions fail. It scans api.go for
// Handle and HandleFunc patterns with any {wildcard}, whatever the prefix or wildcard name.
func TestEveryTripRouteHasTheVisibilityRule(t *testing.T) {
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatal(err)
	}
	registered := map[string]bool{}
	for _, m := range regexp.MustCompile(`\.Handle(?:Func)?\(\s*"([^"]*\{[^"]*)"`).FindAllStringSubmatch(string(src), -1) {
		registered[m[1]] = true
	}
	known := map[string]bool{}
	for _, rt := range tripRoutes {
		known[rt.pattern] = true
	}
	for _, p := range visibilityExempt {
		known[p] = true
	}
	for p := range registered {
		if !known[p] {
			t.Errorf("route %q takes an id but is not in tripRoutes (visibility_test.go): add it, or list it in visibilityExempt with a reason", p)
		}
	}
	for p := range known {
		if !registered[p] {
			t.Errorf("%q is in tripRoutes or visibilityExempt but api.go does not register it: remove or rename the stale entry", p)
		}
	}
}
