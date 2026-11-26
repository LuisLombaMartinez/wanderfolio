package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/claims"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

func invitationPath(tripID string) string { return "/api/trips/" + tripID + "/invitation" }

func question(q string) map[string]any { return map[string]any{"question": q} }

func TestInviterReadsTheInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))

	t.Run("while Pending", func(t *testing.T) {
		status, inv := f.get(t, "sub-leo", invitationPath(id))
		if status != http.StatusOK || inv["status"] != "pending" || inv["question"] != "¿Roma?" ||
			inv["acceptedAt"] != nil || inv["tripId"] != id {
			t.Errorf("got %d %v", status, inv)
		}
	})
	t.Run("the Invitee cannot read it while Pending, and cannot tell the Trip exists", func(t *testing.T) {
		status, body := f.get(t, "sub-ana", invitationPath(id))
		missingStatus, missing := f.get(t, "sub-ana", invitationPath(strings.Repeat("a", 32)))
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" || status != missingStatus || errorCode(body) != errorCode(missing) {
			t.Errorf("got %d %v, want the same as a missing Trip (%d %v)", status, body, missingStatus, missing)
		}
	})
	t.Run("after Sí, with acceptedAt", func(t *testing.T) {
		f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil)
		status, inv := f.get(t, "sub-leo", invitationPath(id))
		if status != http.StatusOK || inv["status"] != "accepted" || inv["acceptedAt"] == nil {
			t.Errorf("got %d %v", status, inv)
		}
	})
	t.Run("a Trip with no Invitation", func(t *testing.T) {
		plain := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))
		status, body := f.get(t, "sub-leo", invitationPath(plain))
		if status != http.StatusNotFound || errorCode(body) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, body)
		}
	})
}

func TestEditTheQuestion(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))

	t.Run("only the Inviter, and the Invitee sees nothing of the hidden Trip", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-ana", invitationPath(id), question("¿Mi pregunta?"))
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("got %d %v, want 404 trip-not-found", status, body)
		}
		_, inv := f.get(t, "sub-leo", invitationPath(id))
		if inv["question"] != "¿Roma?" {
			t.Errorf("question = %v, want it unchanged", inv["question"])
		}
	})

	t.Run("the Inviter edits it, trimmed", func(t *testing.T) {
		status, inv := f.send(t, http.MethodPut, "sub-leo", invitationPath(id), question("  ¿Vienes a Roma?  "))
		if status != http.StatusOK || inv["question"] != "¿Vienes a Roma?" || inv["status"] != "pending" {
			t.Fatalf("got %d %v", status, inv)
		}
		_, read := f.get(t, "sub-leo", invitationPath(id))
		if read["question"] != "¿Vienes a Roma?" {
			t.Errorf("stored question = %v", read["question"])
		}
		_, detail := f.get(t, "sub-leo", "/api/trips/"+id)
		if d, _ := detail["invitation"].(map[string]any); d["question"] != "¿Vienes a Roma?" {
			t.Errorf("trip detail invitation = %v", detail["invitation"])
		}
	})

	t.Run("it stays Pending and the Invitee still gets it", func(t *testing.T) {
		list := pending(t, f, "sub-ana")
		if len(list) != 1 || list[0]["question"] != "¿Vienes a Roma?" {
			t.Errorf("pending = %v", list)
		}
	})

	t.Run("the question is validated like at creation", func(t *testing.T) {
		for _, tc := range []struct{ name, q, code string }{
			{"empty", "  ", "question-required"},
			{"too long", strings.Repeat("é", 121), "question-too-long"},
			{"control", "¿Vienes?\x07", "invalid-characters"},
			{"zero-width", "¿Vie\u200bnes?", "invalid-characters"},
			{"bidi", "¿Vienes?\u202e", "invalid-characters"},
			{"line separator", "¿Vienes?\u2028¿Sí?", "invalid-characters"},
		} {
			status, body := f.send(t, http.MethodPut, "sub-leo", invitationPath(id), question(tc.q))
			if status != http.StatusUnprocessableEntity || errorCode(body) != tc.code {
				t.Errorf("%s: got %d %v, want 422 %s", tc.name, status, body, tc.code)
			}
		}
		_, inv := f.get(t, "sub-leo", invitationPath(id))
		if inv["question"] != "¿Vienes a Roma?" {
			t.Errorf("question = %v, a refused edit must change nothing", inv["question"])
		}
	})

	t.Run("120 characters are fine", func(t *testing.T) {
		q := strings.Repeat("é", 120)
		if status, body := f.send(t, http.MethodPut, "sub-leo", invitationPath(id), question(q)); status != http.StatusOK {
			t.Errorf("got %d %v", status, body)
		}
	})

	t.Run("the body must be exactly a question", func(t *testing.T) {
		for _, payload := range []any{"nope", map[string]any{"question": "¿?", "status": "accepted"}, `{"question":"a"} {}`} {
			status, body := f.send(t, http.MethodPut, "sub-leo", invitationPath(id), payload)
			if status != http.StatusBadRequest || errorCode(body) != "invalid-body" {
				t.Errorf("%v: got %d %v, want 400 invalid-body", payload, status, body)
			}
		}
	})

	t.Run("a Trip with no Invitation", func(t *testing.T) {
		plain := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))
		status, body := f.send(t, http.MethodPut, "sub-leo", invitationPath(plain), question("¿?"))
		if status != http.StatusNotFound || errorCode(body) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, body)
		}
	})
}

func TestAcceptedInvitationIsFrozen(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil)

	t.Run("the Inviter cannot edit it", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-leo", invitationPath(id), question("¿Otra?"))
		if status != http.StatusConflict || errorCode(body) != "invitation-accepted" {
			t.Errorf("got %d %v, want 409 invitation-accepted", status, body)
		}
	})
	t.Run("the Inviter cannot delete it", func(t *testing.T) {
		status, body := f.send(t, http.MethodDelete, "sub-leo", invitationPath(id), nil)
		if status != http.StatusConflict || errorCode(body) != "invitation-accepted" {
			t.Errorf("got %d %v, want 409 invitation-accepted", status, body)
		}
	})
	t.Run("the Invitee is not the Inviter", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-ana", invitationPath(id), question("¿Otra?"))
		if status != http.StatusForbidden || errorCode(body) != "not-the-inviter" {
			t.Errorf("edit: got %d %v, want 403 not-the-inviter", status, body)
		}
		status, body = f.send(t, http.MethodDelete, "sub-ana", invitationPath(id), nil)
		if status != http.StatusForbidden || errorCode(body) != "not-the-inviter" {
			t.Errorf("delete: got %d %v, want 403 not-the-inviter", status, body)
		}
	})
	t.Run("nothing changed", func(t *testing.T) {
		_, inv := f.get(t, "sub-leo", invitationPath(id))
		if inv["question"] != "¿Roma?" || inv["status"] != "accepted" {
			t.Errorf("invitation = %v", inv)
		}
	})
}

func TestDeletePendingInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
	other := f.createTrip(t, "sub-leo", withInvitation("París", "¿París?"))

	t.Run("the Invitee cannot delete it, and cannot tell the Trip exists", func(t *testing.T) {
		status, body := f.send(t, http.MethodDelete, "sub-ana", invitationPath(id), nil)
		if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("got %d %v, want 404 trip-not-found", status, body)
		}
		if status, _ := f.get(t, "sub-leo", invitationPath(id)); status != http.StatusOK {
			t.Errorf("the Invitation must still exist, got %d", status)
		}
	})

	t.Run("the Inviter deletes it", func(t *testing.T) {
		if status, body := f.send(t, http.MethodDelete, "sub-leo", invitationPath(id), nil); status != http.StatusNoContent {
			t.Fatalf("got %d %v, want 204", status, body)
		}
	})

	t.Run("the Trip stays, with no Invitation", func(t *testing.T) {
		status, got := f.get(t, "sub-leo", "/api/trips/"+id)
		if status != http.StatusOK || got["invitation"] != nil {
			t.Errorf("got %d invitation=%v", status, got["invitation"])
		}
		status, body := f.get(t, "sub-leo", invitationPath(id))
		if status != http.StatusNotFound || errorCode(body) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, body)
		}
	})

	t.Run("the Invitee lists and reads the Trip at once", func(t *testing.T) {
		_, list := f.get(t, "sub-ana", "/api/trips")
		ids := tripIDs(t, list)
		if !slices.Contains(ids, id) || slices.Contains(ids, other) {
			t.Errorf("Invitee's Album = %v, want %s and not %s", ids, id, other)
		}
		if status, got := f.get(t, "sub-ana", "/api/trips/"+id); status != http.StatusOK || got["id"] != id {
			t.Errorf("read: %d %v", status, got)
		}
	})

	t.Run("it is gone from the Invitee's Pending list", func(t *testing.T) {
		list := pending(t, f, "sub-ana")
		if len(list) != 1 || list[0]["tripId"] != other {
			t.Errorf("pending = %v, want only %s", list, other)
		}
	})

	t.Run("accepting it is no longer possible", func(t *testing.T) {
		status, body := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil)
		if status != http.StatusNotFound || errorCode(body) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, body)
		}
	})

	t.Run("deleting again is not found", func(t *testing.T) {
		status, body := f.send(t, http.MethodDelete, "sub-leo", invitationPath(id), nil)
		if status != http.StatusNotFound || errorCode(body) != "invitation-not-found" {
			t.Errorf("got %d %v, want 404 invitation-not-found", status, body)
		}
	})
}

// acceptsAfterRead lets the Invitee say "Sí" in the window between the handler reading the
// Invitation (still Pending) and writing its change.
type acceptsAfterRead struct {
	api.Store
	accept func()
}

func (s *acceptsAfterRead) GetInvitation(ctx context.Context, tripID string) (store.Invitation, error) {
	inv, err := s.Store.GetInvitation(ctx, tripID)
	if s.accept != nil {
		accept := s.accept
		s.accept = nil
		accept()
	}
	return inv, err
}

func TestAcceptingMeanwhileIsRefusedNotOverwritten(t *testing.T) {
	for _, tc := range []struct {
		name, method string
		payload      any
	}{
		{"edit", http.MethodPut, question("¿Me da igual?")},
		{"delete", http.MethodDelete, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newInvitationFixture(t)
			id := f.createTrip(t, "sub-leo", withInvitation("Roma", "¿Roma?"))
			racing := &acceptsAfterRead{Store: f.store, accept: func() {
				if _, err := f.store.AcceptInvitation(context.Background(), id); err != nil {
					t.Errorf("accept: %v", err)
				}
			}}
			h := api.NewServer(api.Deps{Store: racing, Uploads: f.media.Uploader, Objects: f.media.Objects, Cookies: f.media.Signer, Workflow: f.wf, Now: f.clock.Now})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				h.ServeHTTP(w, r.WithContext(claims.With(r.Context(), map[string]string{"sub": "sub-leo", "token_use": "access"})))
			}))
			t.Cleanup(srv.Close)
			racer := fixture{server: srv, store: f.store, media: f.media, clock: f.clock, wf: f.wf}

			status, body := racer.send(t, tc.method, "", invitationPath(id), tc.payload)
			if status != http.StatusConflict || errorCode(body) != "invitation-accepted" {
				t.Errorf("got %d %v, want 409 invitation-accepted", status, body)
			}
			_, inv := f.get(t, "sub-leo", invitationPath(id))
			if inv["status"] != "accepted" || inv["question"] != "¿Roma?" {
				t.Errorf("invitation = %v, want the accepted one untouched", inv)
			}
			if status, _ := f.get(t, "sub-ana", "/api/trips/"+id); status != http.StatusOK {
				t.Errorf("the Trip must be visible to the Invitee, got %d", status)
			}
		})
	}
}
