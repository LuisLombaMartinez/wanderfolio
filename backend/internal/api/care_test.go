package api_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

func (f fixture) putObject(t *testing.T, key string) {
	t.Helper()
	_, err := f.media.S3.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket: aws.String(f.media.Bucket), Key: aws.String(key), Body: bytes.NewReader([]byte("x")),
	})
	if err != nil {
		t.Fatalf("put %s: %v", key, err)
	}
}

func (f fixture) photoPath(tripID, photoID string) string {
	return "/api/trips/" + tripID + "/photos/" + photoID
}

func findPhoto(photos []map[string]any, id string) map[string]any {
	for _, p := range photos {
		if p["id"] == id {
			return p
		}
	}
	return nil
}

func TestCaptions(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	id := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10))[0]["photoId"].(string)
	path := f.photoPath(tripID, id)
	caption := func(sub, text string) (int, map[string]any) {
		return f.send(t, http.MethodPatch, sub, path, map[string]any{"caption": text})
	}
	shown := func() map[string]any { return findPhoto(photosOfTrip(t, f, tripID), id) }

	t.Run("either Member sets, edits and clears a caption, and it shows on the Trip", func(t *testing.T) {
		if status, body := caption("sub-leo", "  Playa de las Canteras  "); status != 200 || body["caption"] != "Playa de las Canteras" || body["id"] != id {
			t.Fatalf("set: %d %v", status, body)
		}
		if p := shown(); p["caption"] != "Playa de las Canteras" {
			t.Errorf("photo = %v", p)
		}
		if status, body := caption("sub-ana", "Atardecer\ncon Ana"); status != 200 || body["caption"] != "Atardecer\ncon Ana" {
			t.Fatalf("edit by the other Member: %d %v", status, body)
		}
		if status, body := caption("sub-leo", ""); status != 200 || body["caption"] != nil {
			t.Fatalf("clear: %d %v", status, body)
		}
		if p := shown(); p["caption"] != nil || p["status"] != "awaiting-upload" || p["filename"] != "a.jpg" {
			t.Errorf("a cleared caption leaves the rest alone: %v", p)
		}
	})

	t.Run("a caption can be set on a failed Photo", func(t *testing.T) {
		if err := f.store.MarkPhotoFailed(context.Background(), tripID, id, "corrupt"); err != nil {
			t.Fatal(err)
		}
		if status, body := caption("sub-ana", "aun asi"); status != 200 || body["status"] != "failed" {
			t.Fatalf("%d %v", status, body)
		}
	})

	t.Run("validation", func(t *testing.T) {
		for name, tc := range map[string]struct {
			text string
			code string
		}{
			"too long":        {strings.Repeat("a", 501), "caption-too-long"},
			"control chars":   {"hola\x00", "invalid-characters"},
			"escape sequence": {"hola\x1b[31m", "invalid-characters"},
		} {
			if status, body := caption("sub-leo", tc.text); status != 422 || errorCode(body) != tc.code {
				t.Errorf("%s: %d %v", name, status, body)
			}
		}
		if status, _ := caption("sub-leo", strings.Repeat("ñ", 500)); status != 200 {
			t.Errorf("500 runes must be accepted, got %d", status)
		}
		for name, payload := range map[string]any{
			"no caption field": map[string]any{},
			"null caption":     `{"caption": null}`,
			"not json":         "nope",
			"unknown field":    `{"caption":"a","x":1}`,
			"two values":       `{"caption":"a"} {}`,
		} {
			if status, body := f.send(t, http.MethodPatch, "sub-leo", path, payload); status != 400 || errorCode(body) != "invalid-body" {
				t.Errorf("%s: %d %v", name, status, body)
			}
		}
	})

	t.Run("unknown or malformed ids", func(t *testing.T) {
		for _, p := range []string{
			f.photoPath(tripID, strings.Repeat("a", 32)),
			f.photoPath(strings.Repeat("a", 32), id),
			f.photoPath(tripID, "nope"),
			f.photoPath("nope", id),
		} {
			if status, body := f.send(t, http.MethodPatch, "sub-leo", p, map[string]any{"caption": "x"}); status != 404 || errorCode(body) != "photo-not-found" {
				t.Errorf("%s: %d %v", p, status, body)
			}
		}
	})

	t.Run("needs a Member", func(t *testing.T) {
		if status, body := f.send(t, http.MethodPatch, "", path, map[string]any{"caption": "x"}); status != 401 || errorCode(body) != "unauthorized" {
			t.Errorf("%d %v", status, body)
		}
		if status, body := f.send(t, http.MethodPatch, "stranger", path, map[string]any{"caption": "x"}); status != 403 || errorCode(body) != "not-a-member" {
			t.Errorf("%d %v", status, body)
		}
		if status, body := f.send(t, http.MethodDelete, "", path, nil); status != 401 || errorCode(body) != "unauthorized" {
			t.Errorf("delete: %d %v", status, body)
		}
	})
}

func TestPhotoCarriesUploaderName(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	a := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10))[0]["photoId"].(string)
	b := f.requestLinks(t, "sub-ana", tripID, jpeg("b.jpg", 10))[0]["photoId"].(string)
	photos := photosOfTrip(t, f, tripID)
	if got := findPhoto(photos, a)["uploadedBy"]; got != "Leo" {
		t.Errorf("a uploadedBy = %v", got)
	}
	if got := findPhoto(photos, b)["uploadedBy"]; got != "Ana" {
		t.Errorf("b uploadedBy = %v", got)
	}
	// A Member who renames themselves is shown under the new name (the name is looked up, not copied).
	f.addMember(t, "sub-ana", "Anabel")
	if got := findPhoto(photosOfTrip(t, f, tripID), b)["uploadedBy"]; got != "Anabel" {
		t.Errorf("after rename = %v", got)
	}
	status, body := f.send(t, http.MethodPatch, "sub-leo", f.photoPath(tripID, b), map[string]any{"caption": "x"})
	if status != 200 || body["uploadedBy"] != "Anabel" {
		t.Errorf("caption response: %d %v", status, body)
	}
}

func TestDeletePhoto(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	ctx := context.Background()
	keysOf := func(id string) []string {
		return []string{"originals/" + tripID + "/" + id, "media/" + tripID + "/" + id + "/thumb.webp", "media/" + tripID + "/" + id + "/large.webp"}
	}
	res := func(id string) store.Ready {
		k := keysOf(id)
		return store.Ready{TakenAt: "2026-12-01T10:00:00Z", Width: 4, Height: 3, ThumbKey: k[1], LargeKey: k[2]}
	}
	newPhoto := func(name string) string {
		return f.requestLinks(t, "sub-leo", tripID, jpeg(name, 10))[0]["photoId"].(string)
	}
	gone := func(t *testing.T, id string) {
		t.Helper()
		if p := findPhoto(photosOfTrip(t, f, tripID), id); p != nil {
			t.Errorf("photo still listed: %v", p)
		}
		if _, err := f.store.GetPhoto(ctx, tripID, id); err == nil {
			t.Error("record still exists")
		}
		for _, k := range keysOf(id) {
			if f.objectExists(t, k) {
				t.Errorf("object %s still exists", k)
			}
		}
	}
	keep := newPhoto("keep.jpg")
	for _, k := range keysOf(keep) {
		f.putObject(t, k)
	}

	states := map[string]func(id string){
		"awaiting-upload": func(string) {},
		"processing": func(id string) {
			f.putObject(t, keysOf(id)[0])
			_ = f.store.MarkPhotoProcessing(ctx, tripID, id)
		},
		"ready": func(id string) {
			for _, k := range keysOf(id) {
				f.putObject(t, k)
			}
			_ = f.store.MarkPhotoProcessing(ctx, tripID, id)
			_ = f.store.MarkPhotoReady(ctx, tripID, id, res(id))
		},
		"failed": func(id string) {
			f.putObject(t, keysOf(id)[0])
			_ = f.store.MarkPhotoFailed(ctx, tripID, id, "corrupt image")
		},
	}
	for name, setup := range states {
		t.Run("deletes a "+name+" Photo: record, original and web versions", func(t *testing.T) {
			id := newPhoto(name + ".jpg")
			setup(id)
			if status, body := f.send(t, http.MethodDelete, "sub-ana", f.photoPath(tripID, id), nil); status != 204 || body != nil {
				t.Fatalf("delete: %d %v", status, body)
			}
			gone(t, id)
			if status, body := f.send(t, http.MethodDelete, "sub-ana", f.photoPath(tripID, id), nil); status != 404 || errorCode(body) != "photo-not-found" {
				t.Errorf("second delete: %d %v", status, body)
			}
		})
	}

	t.Run("other Photos are untouched", func(t *testing.T) {
		if findPhoto(photosOfTrip(t, f, tripID), keep) == nil {
			t.Error("kept Photo is gone")
		}
		for _, k := range keysOf(keep) {
			if !f.objectExists(t, k) {
				t.Errorf("object %s was deleted", k)
			}
		}
	})

	t.Run("a Photo deleted while processing is not brought back by the workflow's late writes", func(t *testing.T) {
		id := newPhoto("late.jpg")
		f.putObject(t, keysOf(id)[0])
		if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
			t.Fatal(err)
		}
		if status, _ := f.send(t, http.MethodDelete, "sub-leo", f.photoPath(tripID, id), nil); status != 204 {
			t.Fatalf("delete: %d", status)
		}
		for name, err := range map[string]error{
			"processing": f.store.MarkPhotoProcessing(ctx, tripID, id),
			"ready":      f.store.MarkPhotoReady(ctx, tripID, id, res(id)),
			"failed":     f.store.MarkPhotoFailed(ctx, tripID, id, "late"),
		} {
			if err != nil {
				t.Errorf("late %s write must be a quiet no-op: %v", name, err)
			}
		}
		if _, err := f.store.GetPhoto(ctx, tripID, id); err == nil {
			t.Error("a late write resurrected the record")
		}
		if p := findPhoto(photosOfTrip(t, f, tripID), id); p != nil {
			t.Errorf("a late write resurrected the Photo: %v", p)
		}
	})

	t.Run("unknown ids", func(t *testing.T) {
		for _, p := range []string{f.photoPath(tripID, strings.Repeat("b", 32)), f.photoPath(tripID, "nope")} {
			if status, body := f.send(t, http.MethodDelete, "sub-leo", p, nil); status != 404 || errorCode(body) != "photo-not-found" {
				t.Errorf("%s: %d %v", p, status, body)
			}
		}
	})
}

// With versioning on, as in the deployed bucket, a delete only adds a delete marker: the original
// stays recoverable.
func TestDeletedOriginalStaysRecoverable(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	ctx := context.Background()
	if _, err := f.media.S3.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{
		Bucket:                  aws.String(f.media.Bucket),
		VersioningConfiguration: &s3types.VersioningConfiguration{Status: s3types.BucketVersioningStatusEnabled},
	}); err != nil {
		t.Fatalf("enable versioning: %v", err)
	}
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	id := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10))[0]["photoId"].(string)
	key := "originals/" + tripID + "/" + id
	f.putObject(t, key)
	if status, _ := f.send(t, http.MethodDelete, "sub-leo", f.photoPath(tripID, id), nil); status != 204 {
		t.Fatalf("delete: %d", status)
	}
	if f.objectExists(t, key) {
		t.Error("the original is still current")
	}
	out, err := f.media.S3.ListObjectVersions(ctx, &s3.ListObjectVersionsInput{Bucket: aws.String(f.media.Bucket), Prefix: aws.String(key)})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Versions) != 1 || len(out.DeleteMarkers) != 1 {
		t.Errorf("want the original kept as a noncurrent version under a delete marker, got %d versions, %d markers", len(out.Versions), len(out.DeleteMarkers))
	}
}

func TestDeleteTripCascadesToPhotos(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	otherID := f.createTrip(t, "sub-leo", trip("Madrid", "2026-05-01", "2026-05-03"))
	ctx := context.Background()

	const photos = 200
	var ids []string
	for len(ids) < photos {
		batch := make([]file, 0, 50)
		for i := 0; i < 50; i++ {
			batch = append(batch, jpeg(fmt.Sprintf("p%d.jpg", len(ids)+i), 10))
		}
		for _, r := range f.requestLinks(t, "sub-leo", tripID, batch...) {
			ids = append(ids, r["photoId"].(string))
		}
	}
	otherPhoto := f.requestLinks(t, "sub-leo", otherID, jpeg("m.jpg", 10))[0]["photoId"].(string)
	otherKey := "originals/" + otherID + "/" + otherPhoto
	f.putObject(t, otherKey)

	// Every state, with the objects each would have.
	var keys []string
	for i, id := range ids {
		keys = append(keys, "originals/"+tripID+"/"+id)
		if i%2 == 0 {
			keys = append(keys, "media/"+tripID+"/"+id+"/thumb.webp", "media/"+tripID+"/"+id+"/large.webp")
			_ = f.store.MarkPhotoProcessing(ctx, tripID, id)
			_ = f.store.MarkPhotoReady(ctx, tripID, id, store.Ready{TakenAt: "2026-12-01T10:00:00Z", ThumbKey: "t", LargeKey: "l"})
		}
	}
	var wg sync.WaitGroup
	lanes := make(chan struct{}, 16)
	for _, k := range keys {
		wg.Add(1)
		lanes <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-lanes }()
			f.putObject(t, k)
		}()
	}
	wg.Wait()

	start := time.Now()
	status, body := f.send(t, http.MethodDelete, "sub-leo", "/api/trips/"+tripID, nil)
	elapsed := time.Since(start)
	if status != 204 {
		t.Fatalf("delete trip: %d %v", status, body)
	}
	t.Logf("deleted a Trip with %d Photos and %d objects in %s", photos, len(keys), elapsed)
	if elapsed > 8*time.Second {
		t.Errorf("took %s; the Lambda timeout is 10 s", elapsed)
	}

	if left, err := f.store.ListPhotoIDs(ctx, tripID); err != nil || len(left) != 0 {
		t.Errorf("photo records left: %d (%v)", len(left), err)
	}
	if status, body := f.get(t, "sub-leo", "/api/trips/"+tripID); status != 404 || errorCode(body) != "trip-not-found" {
		t.Errorf("trip after delete: %d %v", status, body)
	}
	for _, k := range keys {
		if f.objectExists(t, k) {
			t.Fatalf("object %s still exists", k)
		}
	}
	if !f.objectExists(t, otherKey) {
		t.Error("another Trip's object was deleted")
	}
	if status, body := f.get(t, "sub-leo", "/api/trips/"+otherID); status != 200 || len(photosOf(body)) != 1 {
		t.Errorf("other trip: %d %v", status, body)
	}
}

// deletingUploads deletes the Trip the first time a link is presigned: the moment between
// the handler's Trip check and its Photo write.
type deletingUploads struct {
	api.Uploads
	once   sync.Once
	remove func()
}

func (u *deletingUploads) PresignUpload(ctx context.Context, key, contentType string, maxBytes int64) (media.Upload, error) {
	u.once.Do(u.remove)
	return u.Uploads.PresignUpload(ctx, key, contentType, maxBytes)
}

func TestUploadLinksForATripDeletedMeanwhileLeaveNoPhotos(t *testing.T) {
	var f fixture
	var tripID string
	f = newFixtureWith(t, time.Now(), func(real api.Uploads) api.Uploads {
		return &deletingUploads{Uploads: real, remove: func() {
			if err := f.store.DeleteTrip(context.Background(), tripID); err != nil {
				t.Errorf("delete trip: %v", err)
			}
		}}
	})
	f.addMember(t, "sub-leo", "Leo")
	tripID = f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))

	status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips/"+tripID+"/photos/upload-links",
		map[string]any{"files": []file{jpeg("a.jpg", 1)}})
	if status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
		t.Fatalf("got %d %v, want 404 trip-not-found", status, body)
	}
	ids, err := f.store.ListPhotoIDs(context.Background(), tripID)
	if err != nil || len(ids) != 0 {
		t.Errorf("orphan Photo records of a deleted Trip: %v (err %v)", ids, err)
	}
}
