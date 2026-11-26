package api_test

import (
	"net/http"
	"testing"
	"time"
)

// listedInvitation returns the "invitation" field of the Trip with the given id in the
// member's Album list, and whether the Trip is listed at all.
func listedInvitation(t *testing.T, f fixture, sub, id string) (inv any, listed bool) {
	t.Helper()
	status, body := f.get(t, sub, "/api/trips")
	if status != http.StatusOK {
		t.Fatalf("list: %d %v", status, body)
	}
	for _, tr := range body["trips"].([]any) {
		m := tr.(map[string]any)
		if m["id"] != id {
			continue
		}
		v, present := m["invitation"]
		if !present {
			t.Fatalf("Trip %s in the list has no \"invitation\" key: %v", id, m)
		}
		return v, true
	}
	return nil, false
}

func TestEitherMemberReadsAnAcceptedInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	_, created := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", "¿Te vienes conmigo a Roma?"))
	id := created["id"].(string)

	t.Run("before the Sí only the Inviter reads it", func(t *testing.T) {
		status, _ := f.get(t, "sub-ana", "/api/trips/"+id)
		if status != http.StatusNotFound {
			t.Errorf("Invitee read = %d, want 404", status)
		}
		_, got := f.get(t, "sub-leo", "/api/trips/"+id)
		if inv, _ := got["invitation"].(map[string]any); inv["status"] != "pending" {
			t.Errorf("Inviter invitation = %v", got["invitation"])
		}
	})

	f.clock.Advance(time.Minute)
	if status, body := f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil); status != http.StatusOK {
		t.Fatalf("accept: %d %v", status, body)
	}

	for _, sub := range []string{"sub-leo", "sub-ana"} {
		t.Run("after the Sí "+sub+" reads it with its Trip", func(t *testing.T) {
			status, got := f.get(t, sub, "/api/trips/"+id)
			if status != http.StatusOK {
				t.Fatalf("read: %d %v", status, got)
			}
			inv, _ := got["invitation"].(map[string]any)
			if inv["question"] != "¿Te vienes conmigo a Roma?" || inv["status"] != "accepted" ||
				inv["inviterId"] != "sub-leo" || inv["acceptedAt"] != "2026-11-26T10:01:00.000Z" {
				t.Errorf("invitation = %v", inv)
			}
			if got["destination"] != "Lisboa, Portugal" || got["startDate"] != "2027-03-01" || got["endDate"] != "2027-03-05" {
				t.Errorf("Trip = %v", got)
			}
		})
	}
}

func TestReplayAndRepeatedAcceptChangeNothing(t *testing.T) {
	f := newInvitationFixture(t)
	_, created := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", "¿Vamos?"))
	id := created["id"].(string)
	accept := "/api/trips/" + id + "/invitation/accept"
	_, first := f.send(t, http.MethodPost, "sub-ana", accept, nil)

	// A replay reads the Invitation again; reads do not write.
	for _, sub := range []string{"sub-leo", "sub-ana", "sub-leo"} {
		f.clock.Advance(time.Hour)
		_, got := f.get(t, sub, "/api/trips/"+id)
		if inv, _ := got["invitation"].(map[string]any); inv["acceptedAt"] != first["acceptedAt"] {
			t.Fatalf("after a read by %s: %v, want acceptedAt %v", sub, inv, first["acceptedAt"])
		}
	}
	// A repeated accept (by the Invitee) returns the first acceptance; the Inviter still cannot accept.
	f.clock.Advance(time.Hour)
	if status, again := f.send(t, http.MethodPost, "sub-ana", accept, nil); status != http.StatusOK || again["acceptedAt"] != first["acceptedAt"] {
		t.Errorf("repeat accept = %d %v, want acceptedAt %v", status, again, first["acceptedAt"])
	}
	if status, _ := f.send(t, http.MethodPost, "sub-leo", accept, nil); status != http.StatusForbidden {
		t.Errorf("Inviter accept = %d, want 403", status)
	}
	_, got := f.get(t, "sub-ana", "/api/trips/"+id)
	if inv, _ := got["invitation"].(map[string]any); inv["acceptedAt"] != first["acceptedAt"] {
		t.Errorf("acceptedAt moved: %v, want %v", inv, first["acceptedAt"])
	}
}

func TestAlbumListMarksTripsThatStartedWithAnInvitation(t *testing.T) {
	f := newInvitationFixture(t)
	_, created := f.send(t, http.MethodPost, "sub-leo", "/api/trips", withInvitation("Roma", "¿Vamos?"))
	id := created["id"].(string)
	plain := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-01", "2027-04-03"))

	t.Run("the Inviter sees pending on their Pending Trip", func(t *testing.T) {
		inv, listed := listedInvitation(t, f, "sub-leo", id)
		if !listed || !jsonEqual(inv, map[string]any{"status": "pending"}) {
			t.Errorf("listed=%v invitation=%v, want {status: pending}", listed, inv)
		}
	})
	t.Run("the Invitee does not see the Pending Trip at all", func(t *testing.T) {
		if _, listed := listedInvitation(t, f, "sub-ana", id); listed {
			t.Error("the Pending Trip is listed for the Invitee")
		}
	})

	f.send(t, http.MethodPost, "sub-ana", "/api/trips/"+id+"/invitation/accept", nil)

	for _, sub := range []string{"sub-leo", "sub-ana"} {
		t.Run("both see accepted once it is Accepted: "+sub, func(t *testing.T) {
			inv, listed := listedInvitation(t, f, sub, id)
			if !listed || !jsonEqual(inv, map[string]any{"status": "accepted"}) {
				t.Errorf("listed=%v invitation=%v, want {status: accepted}", listed, inv)
			}
		})
		t.Run("a Trip without an Invitation is null for "+sub, func(t *testing.T) {
			inv, listed := listedInvitation(t, f, sub, plain)
			if !listed || inv != nil {
				t.Errorf("listed=%v invitation=%v, want null", listed, inv)
			}
		})
	}
}

func jsonEqual(a any, b map[string]any) bool {
	m, ok := a.(map[string]any)
	return ok && len(m) == len(b) && m["status"] == b["status"]
}
