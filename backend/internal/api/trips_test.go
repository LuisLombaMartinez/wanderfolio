package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// send sends a JSON request as the given Member and decodes a JSON response body, if any.
func (f fixture) send(t *testing.T, method, sub, path string, payload any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if s, ok := payload.(string); ok {
		buf.WriteString(s)
	} else if payload != nil {
		if err := json.NewEncoder(&buf).Encode(payload); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, f.server.URL+path, &buf)
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
	var body map[string]any
	if res.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			t.Fatalf("decode body (status %d): %v", res.StatusCode, err)
		}
	}
	return res.StatusCode, body
}

func trip(title, start, end string) map[string]any {
	return map[string]any{"title": title, "destination": "Lisboa, Portugal", "startDate": start, "endDate": end}
}

func (f fixture) createTrip(t *testing.T, sub string, in map[string]any) string {
	t.Helper()
	status, body := f.send(t, http.MethodPost, sub, "/api/trips", in)
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, body)
	}
	return body["id"].(string)
}

func TestTripLifecycle(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")

	in := trip("Lisboa", "2027-04-28", "2027-05-07")
	in["description"] = "  Sol y playa  "
	status, created := f.send(t, http.MethodPost, "sub-leo", "/api/trips", in)
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, created)
	}
	id, _ := created["id"].(string)
	if id == "" || created["title"] != "Lisboa" || created["description"] != "Sol y playa" {
		t.Fatalf("created = %v", created)
	}

	t.Run("the other Member reads it", func(t *testing.T) {
		status, got := f.get(t, "sub-ana", "/api/trips/"+id)
		if status != http.StatusOK || got["id"] != id || got["destination"] != "Lisboa, Portugal" ||
			got["startDate"] != "2027-04-28" || got["endDate"] != "2027-05-07" {
			t.Errorf("got %d %v", status, got)
		}
	})

	t.Run("the other Member edits any field, and can clear the description", func(t *testing.T) {
		upd := trip("Oporto", "2027-04-29", "2027-05-08")
		status, got := f.send(t, http.MethodPut, "sub-ana", "/api/trips/"+id, upd)
		if status != http.StatusOK || got["title"] != "Oporto" || got["id"] != id {
			t.Fatalf("update: %d %v", status, got)
		}
		_, again := f.get(t, "sub-leo", "/api/trips/"+id)
		if again["title"] != "Oporto" || again["startDate"] != "2027-04-29" {
			t.Errorf("after update = %v", again)
		}
		if _, has := again["description"]; has {
			t.Errorf("description should be cleared, got %v", again["description"])
		}
	})

	t.Run("the other Member deletes it", func(t *testing.T) {
		status, _ := f.send(t, http.MethodDelete, "sub-ana", "/api/trips/"+id, nil)
		if status != http.StatusNoContent {
			t.Fatalf("delete status = %d", status)
		}
		status, body := f.get(t, "sub-leo", "/api/trips/"+id)
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("after delete: %d %v", status, body)
		}
	})
}

func TestTripListingOrder(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.createTrip(t, "sub-leo", trip("Middle", "2025-06-01", "2025-06-05"))
	old := f.createTrip(t, "sub-leo", trip("Oldest", "2024-01-01", "2024-01-02"))
	f.createTrip(t, "sub-leo", trip("Newest", "2026-12-01", "2026-12-09"))

	order := func() []string {
		_, body := f.get(t, "sub-leo", "/api/trips")
		var titles []string
		for _, x := range body["trips"].([]any) {
			titles = append(titles, x.(map[string]any)["title"].(string))
		}
		return titles
	}
	if got, want := order(), []string{"Newest", "Middle", "Oldest"}; !slices.Equal(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}

	t.Run("editing the start date reorders the Album", func(t *testing.T) {
		f.send(t, http.MethodPut, "sub-leo", "/api/trips/"+old, trip("Oldest", "2027-01-01", "2027-01-02"))
		if got, want := order(), []string{"Oldest", "Newest", "Middle"}; !slices.Equal(got, want) {
			t.Errorf("order = %v, want %v", got, want)
		}
	})
}

// Two Trips that start the same day are listed by descending id: the order is stable
// across reads (ids are random, so it says nothing about which was created first).
func TestTripListingTiebreak(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	a := f.createTrip(t, "sub-leo", trip("A", "2026-05-01", "2026-05-02"))
	b := f.createTrip(t, "sub-leo", trip("B", "2026-05-01", "2026-05-03"))
	want := []string{a, b}
	slices.SortFunc(want, func(x, y string) int { return strings.Compare(y, x) })
	for range 2 {
		_, body := f.get(t, "sub-leo", "/api/trips")
		var got []string
		for _, x := range body["trips"].([]any) {
			got = append(got, x.(map[string]any)["id"].(string))
		}
		if !slices.Equal(got, want) {
			t.Fatalf("ids = %v, want %v", got, want)
		}
	}
}

func TestTripValidation(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	id := f.createTrip(t, "sub-leo", trip("Ok", "2026-01-01", "2026-01-02"))

	bad := map[string]struct {
		in   any
		code string
	}{
		"end before start":     {trip("X", "2026-01-05", "2026-01-04"), "end-before-start"},
		"no title":             {trip("  ", "2026-01-01", "2026-01-02"), "title-required"},
		"no destination":       {map[string]any{"title": "X", "startDate": "2026-01-01", "endDate": "2026-01-02"}, "destination-required"},
		"bad date":             {trip("X", "01/02/2026", "2026-01-02"), "invalid-date"},
		"impossible date":      {trip("X", "2026-02-30", "2026-03-01"), "invalid-date"},
		"missing dates":        {map[string]any{"title": "X", "destination": "Y"}, "invalid-date"},
		"title too long":       {trip(string(bytes.Repeat([]byte("a"), 121)), "2026-01-01", "2026-01-02"), "title-too-long"},
		"not json":             {"{nope", "invalid-body"},
		"destination too long": {map[string]any{"title": "X", "destination": strings.Repeat("a", 121), "startDate": "2026-01-01", "endDate": "2026-01-02"}, "destination-too-long"},
		"description too long": {map[string]any{"title": "X", "destination": "Y", "description": strings.Repeat("a", 2001), "startDate": "2026-01-01", "endDate": "2026-01-02"}, "description-too-long"},
		"121 multibyte title":  {trip(strings.Repeat("ñ", 121), "2026-01-01", "2026-01-02"), "title-too-long"},
		"control character":    {trip("a\u0000b", "2026-01-01", "2026-01-02"), "invalid-characters"},
		"unknown field":        {`{"title":"X","destination":"Y","startDate":"2026-01-01","endDate":"2026-01-02","cover":"x"}`, "invalid-body"},
		"trailing json":        {`{"title":"X","destination":"Y","startDate":"2026-01-01","endDate":"2026-01-02"}{}`, "invalid-body"},
		"body over 64 KB":      {`{"title":"X","destination":"Y","description":"` + strings.Repeat("a", 65<<10) + `"}`, "invalid-body"},
	}
	for name, tc := range bad {
		for _, method := range []string{http.MethodPost, http.MethodPut} {
			path := "/api/trips"
			if method == http.MethodPut {
				path += "/" + id
			}
			t.Run(name+" "+method, func(t *testing.T) {
				status, body := f.send(t, method, "sub-leo", path, tc.in)
				if status != http.StatusBadRequest && status != http.StatusUnprocessableEntity || errorCode(body) != tc.code {
					t.Errorf("got %d %v, want code %s", status, body, tc.code)
				}
			})
		}
	}
}

func TestTripBoundaries(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	id := f.createTrip(t, "sub-leo", trip("Ok", "2026-01-01", "2026-01-02"))

	t.Run("a one-day trip is ok", func(t *testing.T) {
		status, got := f.send(t, http.MethodPut, "sub-leo", "/api/trips/"+id, trip("X", "2026-03-01", "2026-03-01"))
		if status != http.StatusOK || got["startDate"] != got["endDate"] || got["startDate"] != "2026-03-01" {
			t.Errorf("got %d %v", status, got)
		}
	})
	t.Run("120 multibyte characters fit", func(t *testing.T) {
		status, got := f.send(t, http.MethodPost, "sub-leo", "/api/trips", trip(strings.Repeat("ñ", 120), "2026-01-01", "2026-01-02"))
		if status != http.StatusCreated || got["title"] != strings.Repeat("ñ", 120) {
			t.Errorf("got %d", status)
		}
	})
}

func TestTripErrors(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")

	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		var payload any
		if method == http.MethodPut {
			payload = trip("X", "2026-01-01", "2026-01-02")
		}
		status, body := f.send(t, method, "sub-leo", "/api/trips/"+strings.Repeat("a", 32), payload)
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("%s unknown trip: %d %v", method, status, body)
		}
	}
	for _, bad := range []string{"nope", "..%2f..", strings.Repeat("A", 32), strings.Repeat("a", 33)} {
		status, body := f.get(t, "sub-leo", "/api/trips/"+bad)
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("malformed id %q: %d %v", bad, status, body)
		}
	}
	// A failed update must not create the Trip.
	if _, body := f.get(t, "sub-leo", "/api/trips"); len(body["trips"].([]any)) != 0 {
		t.Errorf("update of unknown Trip created one: %v", body)
	}

	t.Run("writes need a Member", func(t *testing.T) {
		status, body := f.send(t, http.MethodPost, "sub-stranger", "/api/trips", trip("X", "2026-01-01", "2026-01-02"))
		if status != http.StatusForbidden || errorCode(body) != "not-a-member" {
			t.Errorf("got %d %v", status, body)
		}
		status, body = f.send(t, http.MethodDelete, "", "/api/trips/x", nil)
		if status != http.StatusUnauthorized || errorCode(body) != "unauthorized" {
			t.Errorf("got %d %v", status, body)
		}
	})
}
