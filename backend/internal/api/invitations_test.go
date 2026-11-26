package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/claims"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

// withInvitation is a Trip body that asks for an Invitation with the given question.
func withInvitation(title, question string) map[string]any {
	in := trip(title, "2027-03-01", "2027-03-05")
	in["invitation"] = map[string]any{"question": question}
	return in
}

func tripIDs(t *testing.T, body map[string]any) []string {
	t.Helper()
	trips, ok := body["trips"].([]any)
	if !ok {
		t.Fatalf("trips = %#v", body["trips"])
	}
	ids := make([]string, 0, len(trips))
	for _, tr := range trips {
		ids = append(ids, tr.(map[string]any)["id"].(string))
	}
	return ids
}

func pending(t *testing.T, f fixture, sub string) []map[string]any {
	t.Helper()
	status, body := f.get(t, sub, "/api/invitations/pending")
	if status != http.StatusOK {
		t.Fatalf("pending: %d %v", status, body)
	}
	list, ok := body["invitations"].([]any)
	if !ok {
		t.Fatalf("invitations = %#v, want a JSON array", body["invitations"])
	}
	out := make([]map[string]any, 0, len(list))
	for _, v := range list {
		out = append(out, v.(map[string]any))
	}
	return out
}

func newInvitationFixture(t *testing.T) fixture {
	t.Helper()
	f := newFixtureWith(t, time.Date(2026, 11, 26, 10, 0, 0, 0, time.UTC), nil)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	return f
}

func TestCreateTripWithInvitation(t *testing.T) {
	f := newInvitationFixture(t)

	status, created := f.send(t, http.MethodPost, "sub-leo", "/api/trips",
		withInvitation("Roma", "  ¿Te vienes conmigo a Roma?  "))
	if status != http.StatusCreated {
		t.Fatalf("create: %d %v", status, created)
	}
	id := created["id"].(string)

	t.Run("the Inviter gets the Trip with its Pending Invitation", func(t *testing.T) {
		inv, ok := created["invitation"].(map[string]any)
		if !ok {
			t.Fatalf("invitation = %#v", created["invitation"])
		}
		if inv["question"] != "¿Te vienes conmigo a Roma?" || inv["status"] != "pending" ||
			inv["inviterId"] != "sub-leo" || inv["inviteeId"] != "sub-ana" || inv["acceptedAt"] != nil {
			t.Errorf("invitation = %v", inv)
		}
	})

	t.Run("the Inviter lists and reads the Trip normally", func(t *testing.T) {
		_, list := f.get(t, "sub-leo", "/api/trips")
		if !slices.Contains(tripIDs(t, list), id) {
			t.Errorf("Inviter's Album = %v, want it to include %s", tripIDs(t, list), id)
		}
		status, got := f.get(t, "sub-leo", "/api/trips/"+id)
		if status != http.StatusOK {
			t.Fatalf("read: %d %v", status, got)
		}
		if inv, _ := got["invitation"].(map[string]any); inv["status"] != "pending" {
			t.Errorf("invitation = %v", got["invitation"])
		}
	})

	t.Run("the Invitee's Album leaves the Trip out", func(t *testing.T) {
		_, list := f.get(t, "sub-ana", "/api/trips")
		if slices.Contains(tripIDs(t, list), id) {
			t.Errorf("Invitee's Album = %v, must not include the hidden Trip", tripIDs(t, list))
		}
	})

	t.Run("a direct read by the Invitee is the same not found as a missing Trip", func(t *testing.T) {
		status, got := f.get(t, "sub-ana", "/api/trips/"+id)
		missingStatus, missing := f.get(t, "sub-ana", "/api/trips/"+strings.Repeat("a", 32))
		if status != http.StatusNotFound || errorCode(got) != "trip-not-found" {
			t.Errorf("got %d %v, want 404 trip-not-found", status, got)
		}
		if status != missingStatus || errorCode(got) != errorCode(missing) {
			t.Errorf("hidden %d %v differs from missing %d %v", status, got, missingStatus, missing)
		}
	})

	t.Run("a Trip without an Invitation has none and is visible to both", func(t *testing.T) {
		plain := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))
		status, got := f.get(t, "sub-ana", "/api/trips/"+plain)
		if status != http.StatusOK {
			t.Fatalf("read: %d %v", status, got)
		}
		if v, present := got["invitation"]; present && v != nil {
			t.Errorf("invitation = %v, want none", v)
		}
	})
}

func TestInvitationQuestionValidation(t *testing.T) {
	f := newInvitationFixture(t)
	for _, tc := range []struct {
		name, question, code string
	}{
		{"empty", "", "question-required"},
		{"only spaces", "   \n ", "question-required"},
		{"121 characters", strings.Repeat("é", 121), "question-too-long"},
		{"control characters", "¿Vienes?\x07", "invalid-characters"},
		{"zero-width space", "¿Vie\u200bnes?", "invalid-characters"},
		{"bidi override", "¿Vienes?\u202e", "invalid-characters"},
		{"line separator", "¿Vienes?\u2028¿Sí?", "invalid-characters"},
		{"paragraph separator", "¿Vienes?\u2029¿Sí?", "invalid-characters"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", tc.question))
			if status != http.StatusUnprocessableEntity || errorCode(body) != tc.code {
				t.Errorf("got %d %v, want 422 %s", status, body, tc.code)
			}
		})
	}

	t.Run("a refused question stores no Trip", func(t *testing.T) {
		_, list := f.get(t, "sub-leo", "/api/trips")
		if ids := tripIDs(t, list); len(ids) != 0 {
			t.Errorf("trips = %v, want none", ids)
		}
	})

	t.Run("120 characters after trimming are fine", func(t *testing.T) {
		q := strings.Repeat("é", 120)
		status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", "  "+q+"  "))
		if status != http.StatusCreated {
			t.Fatalf("got %d %v", status, body)
		}
		if inv := body["invitation"].(map[string]any); inv["question"] != q {
			t.Errorf("question = %v", inv["question"])
		}
	})

	t.Run("the invitation must be an object with a question", func(t *testing.T) {
		in := trip("Roma", "2027-03-01", "2027-03-05")
		in["invitation"] = map[string]any{"question": "¿Vienes?", "inviteeId": "sub-leo"}
		status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips", in)
		if status != http.StatusBadRequest || errorCode(body) != "invalid-body" {
			t.Errorf("got %d %v, want 400 invalid-body", status, body)
		}
	})
}

func TestInvitationCannotBeAddedToAnExistingTrip(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))

	status, body := f.send(t, http.MethodPut, "sub-leo", "/api/trips/"+id, withInvitation("Lisboa", "¿Vienes?"))
	if status != http.StatusUnprocessableEntity || errorCode(body) != "invitation-on-existing-trip" {
		t.Errorf("got %d %v, want 422 invitation-on-existing-trip", status, body)
	}
	if _, got := f.get(t, "sub-ana", "/api/trips/"+id); got["id"] != id {
		t.Errorf("the Trip must stay visible to the other Member, got %v", got)
	}
	if list := pending(t, f, "sub-ana"); len(list) != 0 {
		t.Errorf("pending = %v, want none", list)
	}
}

func TestPendingInvitations(t *testing.T) {
	f := newInvitationFixture(t)

	first := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	f.clock.Advance(time.Minute)
	// Created later but starting earlier: order is by when the Invitation was made.
	in := withInvitation("París", "¿París?")
	in["startDate"], in["endDate"] = "2027-01-10", "2027-01-12"
	in["destination"] = "París"
	second := f.createTrip(t, "sub-leo", in)
	f.clock.Advance(time.Minute)
	mine := f.createTrip(t, "sub-ana", withInvitation("Oporto", "¿Oporto?"))

	t.Run("lists the Invitee's Pending Invitations oldest first, ready to render", func(t *testing.T) {
		list := pending(t, f, "sub-ana")
		if len(list) != 2 {
			t.Fatalf("pending = %v, want 2", list)
		}
		if list[0]["tripId"] != first || list[1]["tripId"] != second {
			t.Errorf("order = %v, %v; want %s then %s", list[0]["tripId"], list[1]["tripId"], first, second)
		}
		p := list[1]
		if p["question"] != "¿París?" || p["destination"] != "París" ||
			p["startDate"] != "2027-01-10" || p["endDate"] != "2027-01-12" || p["status"] != "pending" {
			t.Errorf("pending item = %v", p)
		}
	})

	t.Run("the Inviter's own Invitations are not in their Pending list", func(t *testing.T) {
		list := pending(t, f, "sub-leo")
		if len(list) != 1 || list[0]["tripId"] != mine {
			t.Errorf("pending = %v, want only %s", list, mine)
		}
	})

	t.Run("requires a Member", func(t *testing.T) {
		status, body := f.get(t, "sub-stranger", "/api/invitations/pending")
		if status != http.StatusForbidden || errorCode(body) != "not-a-member" {
			t.Errorf("got %d %v", status, body)
		}
	})
}

func TestAcceptInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	accept := "/api/trips/" + id + "/invitation/accept"

	t.Run("the Inviter cannot accept", func(t *testing.T) {
		status, body := f.send(t, http.MethodPost, "sub-leo", accept, nil)
		if status != http.StatusForbidden || errorCode(body) != "not-the-invitee" {
			t.Errorf("got %d %v, want 403 not-the-invitee", status, body)
		}
		if list := pending(t, f, "sub-ana"); len(list) != 1 {
			t.Errorf("still pending = %v", list)
		}
	})

	f.clock.Advance(time.Hour)
	acceptedAt := f.clock.Now().UTC()
	status, body := f.send(t, http.MethodPost, "sub-ana", accept, nil)
	if status != http.StatusOK {
		t.Fatalf("accept: %d %v", status, body)
	}

	t.Run("accepting records accepted-at and reveals the Trip", func(t *testing.T) {
		got, _ := time.Parse(time.RFC3339, body["acceptedAt"].(string))
		if body["status"] != "accepted" || !got.Equal(acceptedAt.Truncate(time.Millisecond)) {
			t.Errorf("accepted = %v, want acceptedAt %s", body, acceptedAt)
		}
		status, trip := f.get(t, "sub-ana", "/api/trips/"+id)
		if status != http.StatusOK {
			t.Fatalf("read: %d %v", status, trip)
		}
		if inv, _ := trip["invitation"].(map[string]any); inv["status"] != "accepted" {
			t.Errorf("invitation = %v", trip["invitation"])
		}
		_, list := f.get(t, "sub-ana", "/api/trips")
		if !slices.Contains(tripIDs(t, list), id) {
			t.Errorf("Album = %v, want %s", tripIDs(t, list), id)
		}
		if list := pending(t, f, "sub-ana"); len(list) != 0 {
			t.Errorf("pending = %v, want none", list)
		}
	})

	t.Run("accepting again succeeds and keeps the first accepted-at", func(t *testing.T) {
		f.clock.Advance(time.Hour)
		status, again := f.send(t, http.MethodPost, "sub-ana", accept, nil)
		if status != http.StatusOK || again["acceptedAt"] != body["acceptedAt"] {
			t.Errorf("got %d %v, want acceptedAt %v", status, again, body["acceptedAt"])
		}
	})

	t.Run("a Trip without an Invitation has nothing to accept", func(t *testing.T) {
		plain := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))
		status, got := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+plain+"/invitation/accept", nil)
		if status != http.StatusNotFound || errorCode(got) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, got)
		}
	})

	t.Run("a Trip deleted before the accept is not found", func(t *testing.T) {
		gone := f.createTrip(t, "sub-leo", withInvitation("Oslo", "¿Oslo?"))
		if status, body := f.send(t, http.MethodDelete, "sub-leo", "/api/trips/"+gone, nil); status != http.StatusNoContent {
			t.Fatalf("delete: %d %v", status, body)
		}
		status, got := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+gone+"/invitation/accept", nil)
		if status != http.StatusNotFound || errorCode(got) != "trip-not-found" {
			t.Errorf("got %d %v, want 404 trip-not-found", status, got)
		}
	})

	t.Run("a missing Trip is not found", func(t *testing.T) {
		status, got := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+strings.Repeat("b", 32)+"/invitation/accept", nil)
		if status != http.StatusNotFound || errorCode(got) != "trip-not-found" {
			t.Errorf("got %d %v, want 404 trip-not-found", status, got)
		}
	})
}

func TestDeletingATripDeletesItsInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	if status, body := f.send(t, http.MethodDelete, "sub-leo", "/api/trips/"+id, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d %v", status, body)
	}
	if list := pending(t, f, "sub-ana"); len(list) != 0 {
		t.Errorf("pending = %v, want none after the Trip is deleted", list)
	}
}

func TestInvitationNeedsTheOtherMember(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", "¿Roma?"))
	if status != http.StatusConflict || errorCode(body) != "invitee-missing" {
		t.Errorf("got %d %v, want 409 invitee-missing", status, body)
	}
}

// Until it says "Sí" the Invitee must not be able to edit or delete the Trip, and must not
// be able to tell it from a missing one.
func TestHiddenTripCannotBeChangedByTheInvitee(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	missing := strings.Repeat("a", 32)

	for _, tc := range []struct {
		name, method string
		payload      any
	}{
		{"PUT", http.MethodPut, trip("Cambiado", "2027-03-01", "2027-03-05")},
		{"DELETE", http.MethodDelete, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, got := f.send(t, tc.method, "sub-ana", "/api/trips/"+id, tc.payload)
			mStatus, miss := f.send(t, tc.method, "sub-ana", "/api/trips/"+missing, tc.payload)
			if status != http.StatusNotFound || errorCode(got) != "trip-not-found" {
				t.Errorf("got %d %v, want 404 trip-not-found", status, got)
			}
			if status != mStatus || errorCode(got) != errorCode(miss) {
				t.Errorf("hidden %d %v differs from missing %d %v", status, got, mStatus, miss)
			}
		})
	}

	status, got := f.get(t, "sub-leo", "/api/trips/"+id)
	if status != http.StatusOK || got["title"] != "Roma" {
		t.Errorf("Trip after the Invitee's attempts: %d %v, want it untouched", status, got)
	}
	if list := pending(t, f, "sub-ana"); len(list) != 1 {
		t.Errorf("pending = %v, want the Invitation still there", list)
	}
}

// staleIndexStore answers the Pending list as an eventually consistent index could just
// after an accept: still listing the Invitation that was accepted.
type staleIndexStore struct {
	api.Store
	stale []store.Invitation
}

func (s staleIndexStore) ListPendingInvitations(context.Context, string) ([]store.Invitation, error) {
	return s.stale, nil
}

func TestPendingListSkipsInvitationsAlreadyAccepted(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	inv, err := f.store.GetInvitation(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if status, body := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil); status != http.StatusOK {
		t.Fatalf("accept: %d %v", status, body)
	}
	inv.AcceptedAt = "" // the index still has the Pending entry

	h := api.NewServer(api.Deps{Store: staleIndexStore{Store: f.store, stale: []store.Invitation{inv}}, Uploads: f.media.Uploader, Objects: f.media.Objects, Cookies: f.media.Signer, Workflow: f.wf, Now: f.clock.Now})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r.WithContext(claims.With(r.Context(), map[string]string{"sub": "sub-ana", "token_use": "access"})))
	}))
	t.Cleanup(srv.Close)
	res, err := http.Get(srv.URL + "/api/invitations/pending")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Invitations []any `json:"invitations"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || len(body.Invitations) != 0 {
		t.Errorf("got %d %v, want 200 and no Invitations", res.StatusCode, body.Invitations)
	}
}
