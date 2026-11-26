package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

// readyPhotos makes ready Photos with the given taken dates ("" leaves one awaiting upload).
func (f fixture) readyPhotos(t *testing.T, tripID string, taken ...string) []string {
	t.Helper()
	files := make([]file, len(taken))
	for i := range taken {
		files[i] = jpeg("p.jpg", 10)
	}
	links := f.requestLinks(t, "sub-leo", tripID, files...)
	ids := make([]string, len(taken))
	ctx := context.Background()
	for i, l := range links {
		id := l["photoId"].(string)
		ids[i] = id
		if taken[i] == "" {
			continue
		}
		if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
			t.Fatal(err)
		}
		if err := f.store.MarkPhotoReady(ctx, tripID, id, store.Ready{
			TakenAt: taken[i], Width: 10, Height: 10,
			ThumbKey: "media/" + tripID + "/" + id + "/thumb.webp", LargeKey: "media/" + tripID + "/" + id + "/large.webp",
		}); err != nil {
			t.Fatal(err)
		}
	}
	return ids
}

func coverOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	c, ok := body["coverPhoto"]
	if !ok {
		t.Fatalf("no coverPhoto key in %v", body)
	}
	m, _ := c.(map[string]any)
	return m
}

func (f fixture) listedCover(t *testing.T, tripID string) map[string]any {
	t.Helper()
	_, body := f.get(t, "sub-leo", "/api/trips")
	for _, tr := range body["trips"].([]any) {
		m := tr.(map[string]any)
		if m["id"] == tripID {
			return coverOf(t, m)
		}
	}
	t.Fatalf("trip %s not listed", tripID)
	return nil
}

func TestCoverPhoto(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	cover := "/api/trips/" + tripID + "/cover-photo"

	t.Run("a Trip with no Photos has no Cover photo", func(t *testing.T) {
		if c := f.listedCover(t, tripID); c != nil {
			t.Errorf("list cover = %v", c)
		}
		_, body := f.get(t, "sub-leo", "/api/trips/"+tripID)
		if c := coverOf(t, body); c != nil {
			t.Errorf("page cover = %v", c)
		}
	})

	ids := f.readyPhotos(t, tripID, "2026-11-05T10:00:00Z", "2026-11-01T09:30:00Z", "2026-11-09T09:30:00Z", "")
	late, early, last, pending := ids[0], ids[1], ids[2], ids[3]
	thumb := func(id string) string { return "/media/" + tripID + "/" + id + "/thumb.webp" }

	t.Run("with no choice the first Photo in date-taken order is the Cover photo", func(t *testing.T) {
		for name, c := range map[string]map[string]any{"list": f.listedCover(t, tripID), "page": func() map[string]any {
			_, b := f.get(t, "sub-leo", "/api/trips/"+tripID)
			return coverOf(t, b)
		}()} {
			if c["id"] != early || c["thumbnailUrl"] != thumb(early) || c["largeUrl"] != "/media/"+tripID+"/"+early+"/large.webp" || c["chosen"] != false {
				t.Errorf("%s cover = %v", name, c)
			}
		}
	})

	t.Run("either Member can choose a ready Photo of the Trip", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-ana", cover, map[string]any{"photoId": late})
		if status != http.StatusOK {
			t.Fatalf("status %d %v", status, body)
		}
		if c := coverOf(t, body); c["id"] != late || c["chosen"] != true || c["thumbnailUrl"] != thumb(late) {
			t.Errorf("response cover = %v", c)
		}
		if c := f.listedCover(t, tripID); c["id"] != late || c["chosen"] != true {
			t.Errorf("list cover = %v", c)
		}
		_, page := f.get(t, "sub-leo", "/api/trips/"+tripID)
		if c := coverOf(t, page); c["id"] != late {
			t.Errorf("page cover = %v", c)
		}
	})

	t.Run("editing the Trip keeps the choice", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-leo", "/api/trips/"+tripID, trip("Lisboa 2", "2027-04-28", "2027-05-07"))
		if status != http.StatusOK {
			t.Fatalf("status %d %v", status, body)
		}
		if c := coverOf(t, body); c["id"] != late || c["chosen"] != true {
			t.Errorf("cover after edit = %v", c)
		}
	})

	t.Run("a Photo that is not ready is refused", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": pending})
		if status != http.StatusConflict || errorCode(body) != "photo-not-ready" {
			t.Errorf("got %d %v", status, body)
		}
	})

	t.Run("a body without a photoId is a bad request", func(t *testing.T) {
		for name, in := range map[string]map[string]any{"empty object": {}, "empty id": {"photoId": ""}} {
			status, body := f.send(t, http.MethodPut, "sub-leo", cover, in)
			if status != http.StatusBadRequest || errorCode(body) != "invalid-body" {
				t.Errorf("%s: got %d %v", name, status, body)
			}
		}
	})

	t.Run("a Photo of another Trip, an unknown or malformed id is refused", func(t *testing.T) {
		other := f.createTrip(t, "sub-leo", trip("Otro", "2026-05-01", "2026-05-02"))
		foreign := f.readyPhotos(t, other, "2026-05-01T10:00:00Z")[0]
		for name, id := range map[string]string{"other trip": foreign, "unknown": "00000000000000000000000000000000", "malformed": "nope"} {
			status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": id})
			if status != http.StatusNotFound || errorCode(body) != "photo-not-found" {
				t.Errorf("%s: got %d %v", name, status, body)
			}
		}
		if c := f.listedCover(t, tripID); c["id"] != late {
			t.Errorf("choice changed to %v", c)
		}
	})

	t.Run("request errors", func(t *testing.T) {
		if status, body := f.send(t, http.MethodPut, "sub-leo", cover, "{nope"); status != http.StatusBadRequest || errorCode(body) != "invalid-body" {
			t.Errorf("bad body: %d %v", status, body)
		}
		if status, body := f.send(t, http.MethodPut, "sub-leo", "/api/trips/00000000000000000000000000000000/cover-photo", map[string]any{"photoId": late}); status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("unknown trip: %d %v", status, body)
		}
		if status, body := f.send(t, http.MethodPut, "", cover, map[string]any{"photoId": late}); status != http.StatusUnauthorized || errorCode(body) != "unauthorized" {
			t.Errorf("no member: %d %v", status, body)
		}
	})

	t.Run("deleting the chosen Photo falls back to the first Photo", func(t *testing.T) {
		if status, body := f.send(t, http.MethodDelete, "sub-leo", f.photoPath(tripID, late), nil); status != http.StatusNoContent {
			t.Fatalf("delete: %d %v", status, body)
		}
		if c := f.listedCover(t, tripID); c["id"] != early || c["chosen"] != false {
			t.Errorf("list cover = %v", c)
		}
		_, page := f.get(t, "sub-leo", "/api/trips/"+tripID)
		if c := coverOf(t, page); c["id"] != early || c["chosen"] != false {
			t.Errorf("page cover = %v", c)
		}
	})

	t.Run("deleting the default cover moves it to the next Photo by date taken", func(t *testing.T) {
		if status, body := f.send(t, http.MethodDelete, "sub-ana", f.photoPath(tripID, early), nil); status != http.StatusNoContent {
			t.Fatalf("delete: %d %v", status, body)
		}
		if c := f.listedCover(t, tripID); c["id"] != last || c["chosen"] != false {
			t.Errorf("list cover = %v", c)
		}
	})

	t.Run("a deleted Photo cannot be chosen again", func(t *testing.T) {
		status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": late})
		if status != http.StatusNotFound || errorCode(body) != "photo-not-found" {
			t.Errorf("got %d %v", status, body)
		}
	})

	t.Run("deleting the last ready Photo leaves no Cover photo", func(t *testing.T) {
		if status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": last}); status != http.StatusOK {
			t.Fatalf("choose: %d %v", status, body)
		}
		if status, body := f.send(t, http.MethodDelete, "sub-leo", f.photoPath(tripID, last), nil); status != http.StatusNoContent {
			t.Fatalf("delete: %d %v", status, body)
		}
		if c := f.listedCover(t, tripID); c != nil {
			t.Errorf("list cover = %v", c)
		}
		_, page := f.get(t, "sub-leo", "/api/trips/"+tripID)
		if c := coverOf(t, page); c != nil {
			t.Errorf("page cover = %v", c)
		}
	})

	t.Run("deleting a Trip with a chosen cover removes it and the choice", func(t *testing.T) {
		gone := f.createTrip(t, "sub-leo", trip("Se va", "2026-06-01", "2026-06-02"))
		chosen := f.readyPhotos(t, gone, "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z")[1]
		if status, body := f.send(t, http.MethodPut, "sub-ana", "/api/trips/"+gone+"/cover-photo", map[string]any{"photoId": chosen}); status != http.StatusOK {
			t.Fatalf("choose: %d %v", status, body)
		}
		if status, body := f.send(t, http.MethodDelete, "sub-leo", "/api/trips/"+gone, nil); status != http.StatusNoContent {
			t.Fatalf("delete trip: %d %v", status, body)
		}
		if status, body := f.get(t, "sub-leo", "/api/trips/"+gone); status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("get after delete: %d %v", status, body)
		}
		if status, body := f.send(t, http.MethodPut, "sub-ana", "/api/trips/"+gone+"/cover-photo", map[string]any{"photoId": chosen}); status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("choose after delete: %d %v", status, body)
		}
		_, list := f.get(t, "sub-leo", "/api/trips")
		for _, tr := range list["trips"].([]any) {
			if tr.(map[string]any)["id"] == gone {
				t.Errorf("deleted trip still listed")
			}
		}
	})
}

// A Photo that reads as failed under the staleness rule (processing for too long) is not ready:
// it is never the Cover photo and cannot be chosen, until a late ready write lands.
func TestCoverPhotoIgnoresStaleProcessingPhotos(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	cover := "/api/trips/" + tripID + "/cover-photo"
	ready := f.readyPhotos(t, tripID, "2026-11-05T10:00:00Z")[0]
	stale := f.requestLinks(t, "sub-leo", tripID, jpeg("b.jpg", 10))[0]["photoId"].(string)
	ctx := context.Background()
	if err := f.store.MarkPhotoProcessing(ctx, tripID, stale); err != nil {
		t.Fatal(err)
	}
	f.clock.Advance(16 * time.Minute)

	if status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": stale}); status != http.StatusConflict || errorCode(body) != "photo-not-ready" {
		t.Errorf("choose a stale Photo: %d %v", status, body)
	}
	if c := f.listedCover(t, tripID); c["id"] != ready || c["chosen"] != false {
		t.Errorf("list cover = %v", c)
	}
	_, page := f.get(t, "sub-leo", "/api/trips/"+tripID)
	if c := coverOf(t, page); c["id"] != ready || c["chosen"] != false {
		t.Errorf("page cover = %v", c)
	}

	// A late ready write from the slow execution makes it a Photo like any other.
	if err := f.store.MarkPhotoReady(ctx, tripID, stale, store.Ready{TakenAt: "2026-11-01T10:00:00Z", Width: 4, Height: 3,
		ThumbKey: "media/" + tripID + "/" + stale + "/thumb.webp", LargeKey: "media/" + tripID + "/" + stale + "/large.webp"}); err != nil {
		t.Fatal(err)
	}
	if c := f.listedCover(t, tripID); c["id"] != stale || c["chosen"] != false {
		t.Errorf("after the late ready write the earlier Photo is the default cover: %v", c)
	}
	if status, body := f.send(t, http.MethodPut, "sub-leo", cover, map[string]any{"photoId": stale}); status != http.StatusOK || coverOf(t, body)["chosen"] != true {
		t.Errorf("choose after ready: %d %v", status, body)
	}
}
