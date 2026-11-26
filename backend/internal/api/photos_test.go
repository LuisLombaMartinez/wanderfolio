package api_test

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha1" //nolint:gosec // CloudFront cookies are RSA-SHA1.
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/api"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

type file = map[string]any

func jpeg(name string, size int) file {
	return file{"filename": name, "contentType": "image/jpeg", "size": size}
}

// requestLinks asks for upload links and returns the per-file results.
func (f fixture) requestLinks(t *testing.T, sub, tripID string, files ...file) []map[string]any {
	t.Helper()
	status, body := f.send(t, http.MethodPost, sub, "/api/trips/"+tripID+"/photos/upload-links", map[string]any{"files": files})
	if status != http.StatusOK {
		t.Fatalf("upload links: %d %v", status, body)
	}
	raw, _ := body["results"].([]any)
	out := make([]map[string]any, len(raw))
	for i, r := range raw {
		out[i], _ = r.(map[string]any)
	}
	return out
}

// uploadClient reaches the bucket the way a browser would, whatever host name the link has:
// Floci answers on the one endpoint the tests are configured with.
func uploadClient(t *testing.T) *http.Client {
	t.Helper()
	u, err := url.Parse(os.Getenv("AWS_ENDPOINT_URL"))
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, u.Host)
		},
	}}
}

// postUpload sends the file to the presigned POST. mutate may change the form fields first.
func postUpload(t *testing.T, link map[string]any, data []byte, mutate func(fields map[string]string)) int {
	t.Helper()
	up, _ := link["upload"].(map[string]any)
	if up == nil {
		t.Fatalf("no upload link in %v", link)
	}
	fields := map[string]string{}
	for k, v := range up["fields"].(map[string]any) {
		fields[k] = v.(string)
	}
	if mutate != nil {
		mutate(fields)
	}
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	part, err := mw.CreateFormFile("file", "photo")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = mw.Close()
	req, err := http.NewRequest(http.MethodPost, up["url"].(string), &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := uploadClient(t).Do(req)
	if err != nil {
		t.Fatalf("post to bucket: %v", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (f fixture) objectExists(t *testing.T, key string) bool {
	t.Helper()
	_, err := f.media.S3.HeadObject(context.Background(), &s3.HeadObjectInput{Bucket: aws.String(f.media.Bucket), Key: aws.String(key)})
	return err == nil
}

func photosOf(body map[string]any) []map[string]any {
	raw, _ := body["photos"].([]any)
	out := make([]map[string]any, len(raw))
	for i, r := range raw {
		out[i], _ = r.(map[string]any)
	}
	return out
}

func TestUploadLinks(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))

	t.Run("each accepted file gets a Photo id and a link, and the original can be uploaded", func(t *testing.T) {
		res := f.requestLinks(t, "sub-ana", tripID,
			jpeg("a.jpg", 1000),
			file{"filename": "b.png", "contentType": "image/png", "size": 2000},
			file{"filename": "c.webp", "contentType": "image/webp", "size": 3000},
		)
		if len(res) != 3 {
			t.Fatalf("results = %v", res)
		}
		seen := map[string]bool{}
		for i, r := range res {
			id, _ := r["photoId"].(string)
			if id == "" || seen[id] || r["error"] != nil {
				t.Fatalf("result %d = %v", i, r)
			}
			seen[id] = true
		}
		if got := postUpload(t, res[0], []byte("not really a jpeg"), nil); got/100 != 2 {
			t.Fatalf("upload status = %d", got)
		}
		if !f.objectExists(t, "originals/"+tripID+"/"+res[0]["photoId"].(string)) {
			t.Error("the uploaded original is not in the bucket under originals/<trip>/<photo>")
		}
	})

	t.Run("S3 itself pins the key, the content type and the size", func(t *testing.T) {
		res := f.requestLinks(t, "sub-leo", tripID, jpeg("pinned.jpg", 10))[0]
		for name, mutate := range map[string]func(map[string]string){
			"another key":          func(m map[string]string) { m["key"] = "originals/" + tripID + "/someone-else" },
			"another content type": func(m map[string]string) { m["Content-Type"] = "text/html" },
		} {
			if got := postUpload(t, res, []byte("x"), mutate); got/100 == 2 {
				t.Errorf("%s: upload accepted (status %d)", name, got)
			}
		}
		if got := postUpload(t, res, make([]byte, 30<<20+1), nil); got/100 == 2 {
			t.Errorf("a file over 30 MB was accepted (status %d)", got)
		}
		if got := postUpload(t, res, nil, nil); got/100 == 2 {
			t.Errorf("an empty file was accepted (status %d)", got)
		}
		if f.objectExists(t, "originals/"+tripID+"/"+res["photoId"].(string)) {
			t.Error("a refused upload left an object behind")
		}
		if got := postUpload(t, res, make([]byte, 30<<20), nil); got/100 != 2 {
			t.Errorf("a file of exactly 30 MB was refused (status %d)", got)
		}
	})

	t.Run("refused files get a stable error code and no Photo", func(t *testing.T) {
		before := len(photosOfTrip(t, f, tripID))
		res := f.requestLinks(t, "sub-leo", tripID,
			file{"filename": "x.gif", "contentType": "image/gif", "size": 10},
			file{"filename": "x.heic", "contentType": "image/avif", "size": 10},
			file{"filename": "x.svg", "contentType": "image/svg+xml", "size": 10},
			jpeg("big.jpg", 30<<20+1),
			jpeg("empty.jpg", 0),
			jpeg("", 10),
			jpeg("ok.jpg", 30<<20),
			file{"filename": "upper.jpg", "contentType": "IMAGE/JPEG", "size": 10},
			jpeg(strings.Repeat("ñ", 256)+".jpg", 10),
			jpeg("tab\there.jpg", 10),
			jpeg("new\nline.jpg", 10),
			jpeg(strings.Repeat("ñ", 255), 10),
		)
		want := []string{"unsupported-file-type", "unsupported-file-type", "unsupported-file-type", "file-too-large", "empty-file", "invalid-filename", "",
			"", "invalid-filename", "invalid-filename", "invalid-filename", ""}
		for i, w := range want {
			got := errorCode(res[i])
			if got != w {
				t.Errorf("file %d: code = %q, want %q (%v)", i, got, w, res[i])
			}
			if w != "" && (res[i]["upload"] != nil || res[i]["photoId"] != nil) {
				t.Errorf("file %d was refused but got a link: %v", i, res[i])
			}
		}
		if got := len(photosOfTrip(t, f, tripID)); got != before+3 {
			t.Errorf("photos = %d, want %d: only the accepted files create a Photo", got, before+3)
		}
	})

	t.Run("whole-request problems", func(t *testing.T) {
		path := "/api/trips/" + tripID + "/photos/upload-links"
		many := make([]file, 51)
		for i := range many {
			many[i] = jpeg("a.jpg", 1)
		}
		for _, tc := range []struct {
			name, sub, path string
			body            any
			status          int
			code            string
		}{
			{"no files", "sub-leo", path, map[string]any{"files": []file{}}, 422, "no-files"},
			{"too many files", "sub-leo", path, map[string]any{"files": many}, 422, "too-many-files"},
			{"not json", "sub-leo", path, "{nope", 400, "invalid-body"},
			{"unknown field", "sub-leo", path, `{"files":[],"x":1}`, 400, "invalid-body"},
			{"unknown trip", "sub-leo", "/api/trips/" + strings.Repeat("a", 32) + "/photos/upload-links", map[string]any{"files": []file{jpeg("a.jpg", 1)}}, 404, "trip-not-found"},
			{"malformed trip id", "sub-leo", "/api/trips/nope/photos/upload-links", map[string]any{"files": []file{jpeg("a.jpg", 1)}}, 404, "trip-not-found"},
			{"no claims", "", path, map[string]any{"files": []file{jpeg("a.jpg", 1)}}, 401, "unauthorized"},
			{"not a Member", "sub-stranger", path, map[string]any{"files": []file{jpeg("a.jpg", 1)}}, 403, "not-a-member"},
		} {
			status, body := f.send(t, http.MethodPost, tc.sub, tc.path, tc.body)
			if status != tc.status || errorCode(body) != tc.code {
				t.Errorf("%s: got %d %v, want %d %s", tc.name, status, body, tc.status, tc.code)
			}
		}
	})
}

func photosOfTrip(t *testing.T, f fixture, tripID string) []map[string]any {
	t.Helper()
	status, body := f.get(t, "sub-leo", "/api/trips/"+tripID)
	if status != http.StatusOK {
		t.Fatalf("get trip: %d %v", status, body)
	}
	return photosOf(body)
}

// lifecycleStart is the injected clock's start in TestPhotoLifecycle; the taken dates below are before it.
var lifecycleStart = time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)

func TestPhotoLifecycle(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	ctx := context.Background()

	t.Run("a Trip without Photos has none", func(t *testing.T) {
		_, body := f.get(t, "sub-leo", "/api/trips/"+tripID)
		if ps, ok := body["photos"].([]any); !ok || len(ps) != 0 || body["photoCount"] != float64(0) {
			t.Errorf("body = %v", body)
		}
		if th, ok := body["thumbnails"].([]any); !ok || len(th) != 0 {
			t.Errorf("thumbnails = %#v, want an empty array", body["thumbnails"])
		}
	})

	links := f.requestLinks(t, "sub-leo", tripID, jpeg("late.jpg", 10), jpeg("early.jpg", 10), jpeg("noexif.jpg", 10))
	late, early, noexif := links[0]["photoId"].(string), links[1]["photoId"].(string), links[2]["photoId"].(string)

	t.Run("an issued link shows as awaiting-upload without addresses", func(t *testing.T) {
		ps := photosOfTrip(t, f, tripID)
		if len(ps) != 3 {
			t.Fatalf("photos = %v", ps)
		}
		for _, p := range ps {
			if p["status"] != "awaiting-upload" || p["thumbnailUrl"] != nil || p["id"] == "" {
				t.Errorf("photo = %v", p)
			}
		}
	})

	// The processing workflow does these writes; see the handoff for the contract.
	for _, id := range []string{late, early, noexif} {
		if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("processing is shown, then ready with the version addresses", func(t *testing.T) {
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["status"] != "processing" {
				t.Errorf("photo = %v, want processing", p)
			}
		}
		ready := func(id, taken string) {
			if err := f.store.MarkPhotoReady(ctx, tripID, id, store.Ready{
				TakenAt: taken, Width: 4000, Height: 3000,
				ThumbKey: "media/" + tripID + "/" + id + "/thumb.webp", LargeKey: "media/" + tripID + "/" + id + "/large.webp",
			}); err != nil {
				t.Fatal(err)
			}
		}
		ready(late, "2026-11-05T10:00:00Z")
		ready(early, "2026-11-01T09:30:00Z")
		ps := photosOfTrip(t, f, tripID)
		byID := map[string]map[string]any{}
		for _, p := range ps {
			byID[p["id"].(string)] = p
		}
		if p := byID[late]; p["status"] != "ready" || p["thumbnailUrl"] != "/media/"+tripID+"/"+late+"/thumb.webp" ||
			p["largeUrl"] != "/media/"+tripID+"/"+late+"/large.webp" || p["width"] != float64(4000) || p["height"] != float64(3000) ||
			p["takenAt"] != "2026-11-05T10:00:00Z" || p["filename"] != "late.jpg" {
			t.Errorf("late = %v", p)
		}
		if byID[noexif]["status"] != "processing" {
			t.Errorf("noexif = %v", byID[noexif])
		}
	})

	t.Run("Photos are ordered by date taken, upload time while it is unknown", func(t *testing.T) {
		// noexif has no takenAt: it sorts by when its link was issued (the injected clock,
		// 2026-11-20), after the two taken dates in the past.
		ids := []string{}
		for _, p := range photosOfTrip(t, f, tripID) {
			ids = append(ids, p["id"].(string))
		}
		if want := []string{early, late, noexif}; strings.Join(ids, ",") != strings.Join(want, ",") {
			t.Errorf("order = %v, want %v", ids, want)
		}
	})

	t.Run("the Album and the Trip count ready Photos and list their thumbnails", func(t *testing.T) {
		_, body := f.get(t, "sub-ana", "/api/trips")
		tr := body["trips"].([]any)[0].(map[string]any)
		if tr["photoCount"] != float64(2) {
			t.Errorf("photoCount = %v, want 2 (only ready Photos count)", tr["photoCount"])
		}
		th, _ := tr["thumbnails"].([]any)
		if len(th) != 2 || th[0] != "/media/"+tripID+"/"+early+"/thumb.webp" || th[1] != "/media/"+tripID+"/"+late+"/thumb.webp" {
			t.Errorf("thumbnails = %v", th)
		}
		if tr["photos"] != nil {
			t.Errorf("the listing should not carry every Photo: %v", tr["photos"])
		}
		_, one := f.get(t, "sub-ana", "/api/trips/"+tripID)
		if one["photoCount"] != float64(2) {
			t.Errorf("trip photoCount = %v", one["photoCount"])
		}
	})

	t.Run("a failed Photo shows its reason", func(t *testing.T) {
		if err := f.store.MarkPhotoFailed(ctx, tripID, noexif, "corrupt image"); err != nil {
			t.Fatal(err)
		}
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["id"] == noexif && (p["status"] != "failed" || p["failureReason"] != "corrupt image") {
				t.Errorf("photo = %v", p)
			}
		}
	})

	t.Run("an abandoned upload leaves Trip responses after link lifetime plus 5 minutes, and processing keeps a Photo", func(t *testing.T) {
		again := f.requestLinks(t, "sub-leo", tripID, jpeg("abandoned.jpg", 10), jpeg("arrived.jpg", 10))
		abandoned, arrived := again[0]["photoId"].(string), again[1]["photoId"].(string)
		if err := f.store.MarkPhotoProcessing(ctx, tripID, arrived); err != nil {
			t.Fatal(err)
		}
		has := func(id string) bool {
			for _, p := range photosOfTrip(t, f, tripID) {
				if p["id"] == id {
					return true
				}
			}
			return false
		}
		f.clock.Advance(19 * time.Minute)
		if !has(abandoned) || !has(arrived) {
			t.Fatal("Photos disappeared before the link lifetime plus 5 minutes")
		}
		f.clock.Advance(2 * time.Minute)
		if has(abandoned) {
			t.Error("an abandoned awaiting-upload Photo is still listed after 21 minutes")
		}
		if !has(arrived) {
			t.Error("a Photo whose original arrived disappeared with the upload link")
		}
		f.clock.Advance(24 * time.Hour)
		if !has(arrived) {
			t.Error("a processing Photo expired with the upload link")
		}
	})
}

func TestPhotosNeverMoveBackwards(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	ctx := context.Background()
	links := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10), jpeg("b.jpg", 10), jpeg("c.jpg", 10))
	ready, failed, waiting := links[0]["photoId"].(string), links[1]["photoId"].(string), links[2]["photoId"].(string)
	res := store.Ready{TakenAt: "2026-11-05T10:00:00Z", Width: 40, Height: 30, ThumbKey: "media/t/thumb.webp", LargeKey: "media/t/large.webp"}
	statusOf := func(id string) map[string]any {
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["id"] == id {
				return p
			}
		}
		return nil
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("a conditional write that does not apply must be a quiet no-op: %v", err)
		}
	}

	t.Run("a result before the original arrived changes nothing", func(t *testing.T) {
		must(f.store.MarkPhotoReady(ctx, tripID, waiting, res))
		if p := statusOf(waiting); p["status"] != "awaiting-upload" || p["thumbnailUrl"] != nil {
			t.Errorf("photo = %v", p)
		}
	})

	t.Run("a failure can reach an awaiting-upload Photo, so a Catch on the first step works", func(t *testing.T) {
		lone := f.requestLinks(t, "sub-leo", tripID, jpeg("d.jpg", 10))[0]["photoId"].(string)
		must(f.store.MarkPhotoFailed(ctx, tripID, lone, "workflow-error"))
		if p := statusOf(lone); p["status"] != "failed" || p["failureReason"] != "workflow-error" {
			t.Errorf("photo = %v", p)
		}
	})

	must(f.store.MarkPhotoProcessing(ctx, tripID, ready))
	must(f.store.MarkPhotoProcessing(ctx, tripID, failed))
	must(f.store.MarkPhotoProcessing(ctx, tripID, failed)) // duplicate start is fine
	must(f.store.MarkPhotoReady(ctx, tripID, ready, res))
	must(f.store.MarkPhotoFailed(ctx, tripID, failed, "corrupt image"))

	t.Run("a duplicate start does not undo a result", func(t *testing.T) {
		must(f.store.MarkPhotoProcessing(ctx, tripID, ready))
		must(f.store.MarkPhotoProcessing(ctx, tripID, failed))
		if p := statusOf(ready); p["status"] != "ready" || p["thumbnailUrl"] != "/media/t/thumb.webp" {
			t.Errorf("ready photo = %v", p)
		}
		if p := statusOf(failed); p["status"] != "failed" || p["failureReason"] != "corrupt image" {
			t.Errorf("failed photo = %v", p)
		}
	})

	t.Run("a late failure does not undo ready, a late result does not undo failed", func(t *testing.T) {
		must(f.store.MarkPhotoFailed(ctx, tripID, ready, "late catch"))
		must(f.store.MarkPhotoReady(ctx, tripID, failed, res))
		if p := statusOf(ready); p["status"] != "ready" || p["failureReason"] != nil {
			t.Errorf("ready photo = %v", p)
		}
		if p := statusOf(failed); p["status"] != "failed" || p["thumbnailUrl"] != nil {
			t.Errorf("failed photo = %v", p)
		}
	})

	t.Run("a write for a Photo that is gone is a quiet no-op", func(t *testing.T) {
		must(f.store.MarkPhotoProcessing(ctx, tripID, strings.Repeat("a", 32)))
		must(f.store.MarkPhotoReady(ctx, tripID, strings.Repeat("a", 32), res))
		must(f.store.MarkPhotoFailed(ctx, tripID, strings.Repeat("a", 32), "x"))
	})
}

// failingUploads presigns normally until it has been called failAfter times, then fails.
type failingUploads struct {
	api.Uploads
	failAfter int
	calls     int
}

func (u *failingUploads) PresignUpload(ctx context.Context, key, contentType string, maxBytes int64) (media.Upload, error) {
	u.calls++
	if u.calls > u.failAfter {
		return media.Upload{}, errors.New("presign failed")
	}
	return u.Uploads.PresignUpload(ctx, key, contentType, maxBytes)
}

func TestUploadLinksPartialBatchLeavesNoRecords(t *testing.T) {
	f := newFixtureWith(t, time.Now(), func(real api.Uploads) api.Uploads {
		return &failingUploads{Uploads: real, failAfter: 2}
	})
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))

	status, body := f.send(t, http.MethodPost, "sub-leo", "/api/trips/"+tripID+"/photos/upload-links",
		map[string]any{"files": []file{jpeg("a.jpg", 1), jpeg("b.jpg", 1), jpeg("c.jpg", 1)}})
	if status != http.StatusInternalServerError || errorCode(body) != "internal" {
		t.Fatalf("got %d %v, want 500 internal", status, body)
	}
	if got := photosOfTrip(t, f, tripID); len(got) != 0 {
		t.Errorf("the failed request left Photos behind: %v", got)
	}
}

func TestMediaSession(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")

	post := func(sub string) *http.Response {
		req, _ := http.NewRequest(http.MethodPost, f.server.URL+"/api/media-session", nil)
		if sub != "" {
			req.Header.Set(testSubHeader, sub)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = res.Body.Close() })
		return res
	}

	t.Run("sets signed cookies scoped to /media for a few hours", func(t *testing.T) {
		before := time.Now()
		res := post("sub-leo")
		if res.StatusCode != http.StatusOK {
			t.Fatalf("status = %d", res.StatusCode)
		}
		var body map[string]string
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		exp, err := time.Parse(time.RFC3339, body["expiresAt"])
		if err != nil || exp.Before(before.Add(3*time.Hour)) || exp.After(before.Add(8*time.Hour)) {
			t.Errorf("expiresAt = %q, want a few hours from now", body["expiresAt"])
		}
		got := map[string]*http.Cookie{}
		for _, c := range res.Cookies() {
			got[c.Name] = c
			if c.Path != "/media" || !c.HttpOnly || !c.Secure || c.Domain != "" {
				t.Errorf("cookie %s: path %q httpOnly %v secure %v domain %q", c.Name, c.Path, c.HttpOnly, c.Secure, c.Domain)
			}
			if c.Expires.Before(before.Add(3*time.Hour)) || c.Expires.After(before.Add(8*time.Hour)) {
				t.Errorf("cookie %s expires %v", c.Name, c.Expires)
			}
		}
		if len(got) != 3 || got["CloudFront-Policy"] == nil || got["CloudFront-Signature"] == nil || got["CloudFront-Key-Pair-Id"] == nil {
			t.Fatalf("cookies = %v", res.Cookies())
		}
		if got["CloudFront-Key-Pair-Id"].Value != f.media.KeyPairID {
			t.Errorf("key pair id = %q", got["CloudFront-Key-Pair-Id"].Value)
		}

		policy, sig := cfDecode(t, got["CloudFront-Policy"].Value), cfDecode(t, got["CloudFront-Signature"].Value)
		digest := sha1.Sum(policy) //nolint:gosec // see import
		if err := rsa.VerifyPKCS1v15(f.media.PublicKey, crypto.SHA1, digest[:], sig); err != nil {
			t.Errorf("signature does not verify against the signing key: %v", err)
		}
		var p struct {
			Statement []struct {
				Condition struct {
					DateLessThan struct {
						EpochTime int64 `json:"AWS:EpochTime"`
					}
				}
			}
		}
		if err := json.Unmarshal(policy, &p); err != nil || len(p.Statement) != 1 ||
			p.Statement[0].Condition.DateLessThan.EpochTime != exp.Unix() {
			t.Errorf("policy = %s (%v)", policy, err)
		}
	})

	t.Run("needs a Member", func(t *testing.T) {
		if res := post(""); res.StatusCode != http.StatusUnauthorized || len(res.Cookies()) != 0 {
			t.Errorf("no claims: %d with %d cookies", res.StatusCode, len(res.Cookies()))
		}
		if res := post("sub-stranger"); res.StatusCode != http.StatusForbidden || len(res.Cookies()) != 0 {
			t.Errorf("stranger: %d with %d cookies", res.StatusCode, len(res.Cookies()))
		}
	})
}

func cfDecode(t *testing.T, v string) []byte {
	t.Helper()
	v = strings.NewReplacer("-", "+", "_", "=", "~", "/").Replace(v)
	b, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		t.Fatalf("decode %q: %v", v, err)
	}
	return b
}

func TestHEIFUploadLinks(t *testing.T) {
	f := newFixture(t)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))

	res := f.requestLinks(t, "sub-leo", tripID,
		file{"filename": "IMG_1.heic", "contentType": "image/heic", "size": 2000},
		file{"filename": "IMG_2.heif", "contentType": "image/heif", "size": 2000},
		file{"filename": "IMG_3.HEIC", "contentType": "", "size": 2000},
		file{"filename": "IMG_4.heif", "contentType": "application/octet-stream", "size": 2000},
		file{"filename": "IMG_5.bin", "contentType": "application/octet-stream", "size": 2000},
		file{"filename": "IMG_6.heic", "contentType": "image/heic", "size": 30<<20 + 1},
	)
	for i := 0; i < 4; i++ {
		if res[i]["error"] != nil || res[i]["photoId"] == nil {
			t.Fatalf("file %d refused: %v", i, res[i])
		}
	}
	if code := errorCode(res[4]); code != "unsupported-file-type" {
		t.Errorf("unknown extension and type: code = %q", code)
	}
	if code := errorCode(res[5]); code != "file-too-large" {
		t.Errorf("big HEIC: code = %q", code)
	}
	// S3 pins the type: the form carries the type implied by the extension.
	want := []string{"image/heic", "image/heif", "image/heic", "image/heif"}
	for i, w := range want {
		fields := res[i]["upload"].(map[string]any)["fields"].(map[string]any)
		if fields["Content-Type"] != w {
			t.Errorf("file %d: pinned type = %v, want %s", i, fields["Content-Type"], w)
		}
	}
	if got := postUpload(t, res[0], []byte("heic bytes"), nil); got/100 != 2 {
		t.Errorf("uploading a HEIC original: status %d", got)
	}
	if got := postUpload(t, res[0], []byte("x"), func(m map[string]string) { m["Content-Type"] = "image/jpeg" }); got/100 == 2 {
		t.Errorf("S3 accepted another content type for a HEIC link")
	}
}

func TestRetryPhoto(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	ctx := context.Background()
	links := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10), jpeg("b.jpg", 10), jpeg("c.jpg", 10))
	failed, ready, waiting := links[0]["photoId"].(string), links[1]["photoId"].(string), links[2]["photoId"].(string)
	for _, id := range []string{failed, ready} {
		if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.store.MarkPhotoFailed(ctx, tripID, failed, "corrupt image"); err != nil {
		t.Fatal(err)
	}
	if err := f.store.MarkPhotoReady(ctx, tripID, ready, store.Ready{TakenAt: "2026-11-05T10:00:00Z", Width: 4, Height: 3, ThumbKey: "media/x/thumb.webp", LargeKey: "media/x/large.webp"}); err != nil {
		t.Fatal(err)
	}
	retry := func(sub, trip, photo string) (int, map[string]any) {
		return f.send(t, http.MethodPost, sub, "/api/trips/"+trip+"/photos/"+photo+"/retry", nil)
	}
	photo := func(id string) map[string]any {
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["id"] == id {
				return p
			}
		}
		return nil
	}

	t.Run("it needs a Member", func(t *testing.T) {
		if status, body := retry("", tripID, failed); status != http.StatusUnauthorized || errorCode(body) != "unauthorized" {
			t.Errorf("no claims: %d %v", status, body)
		}
		if status, body := retry("sub-stranger", tripID, failed); status != http.StatusForbidden || errorCode(body) != "not-a-member" {
			t.Errorf("not a Member: %d %v", status, body)
		}
		if len(f.wf.started()) != 0 || photo(failed)["status"] != "failed" {
			t.Error("a refused request changed something")
		}
	})

	t.Run("unknown Trip or Photo", func(t *testing.T) {
		if status, body := retry("sub-ana", strings.Repeat("a", 32), failed); status != http.StatusNotFound || errorCode(body) != "photo-not-found" {
			t.Errorf("unknown trip: %d %v", status, body)
		}
		if status, body := retry("sub-ana", "nope", failed); status != http.StatusNotFound || errorCode(body) != "trip-not-found" {
			t.Errorf("malformed trip: %d %v", status, body)
		}
		if status, body := retry("sub-ana", tripID, strings.Repeat("a", 32)); status != http.StatusNotFound || errorCode(body) != "photo-not-found" {
			t.Errorf("unknown photo: %d %v", status, body)
		}
		if status, body := retry("sub-ana", tripID, "x"); status != http.StatusNotFound || errorCode(body) != "photo-not-found" {
			t.Errorf("malformed photo: %d %v", status, body)
		}
	})

	t.Run("only a failed Photo can be retried", func(t *testing.T) {
		for _, id := range []string{ready, waiting} {
			before := photo(id)["status"]
			if status, body := retry("sub-ana", tripID, id); status != http.StatusConflict || errorCode(body) != "photo-not-failed" {
				t.Errorf("%v photo: %d %v", before, status, body)
			}
			if photo(id)["status"] != before {
				t.Errorf("a refused retry moved a %v Photo", before)
			}
		}
		if len(f.wf.started()) != 0 {
			t.Errorf("workflow started for a Photo that is not failed: %v", f.wf.started())
		}
	})

	t.Run("a workflow that cannot start leaves the Photo failed with its reason", func(t *testing.T) {
		f.wf.err = errors.New("states unavailable")
		status, body := retry("sub-ana", tripID, failed)
		f.wf.err = nil
		if status != http.StatusInternalServerError || errorCode(body) != "internal" {
			t.Errorf("status %d %v", status, body)
		}
		if p := photo(failed); p["status"] != "failed" || p["failureReason"] != "corrupt image" {
			t.Errorf("photo = %v", p)
		}
	})

	t.Run("a failed Photo goes back to processing and the workflow starts on its original", func(t *testing.T) {
		status, body := retry("sub-ana", tripID, failed)
		if status != http.StatusOK || body["id"] != failed || body["status"] != "processing" || body["failureReason"] != nil {
			t.Fatalf("status %d %v", status, body)
		}
		if p := photo(failed); p["status"] != "processing" || p["failureReason"] != nil {
			t.Errorf("photo = %v", p)
		}
		if got, want := f.wf.started(), []string{"originals/" + tripID + "/" + failed}; strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("started = %v, want %v", got, want)
		}
	})

	t.Run("a second retry while processing is refused and starts nothing", func(t *testing.T) {
		if status, body := retry("sub-leo", tripID, failed); status != http.StatusConflict || errorCode(body) != "photo-not-failed" {
			t.Errorf("status %d %v", status, body)
		}
		if len(f.wf.started()) != 1 {
			t.Errorf("started = %v", f.wf.started())
		}
	})

	t.Run("the workflow's own writes still work after a retry, and failed can come back", func(t *testing.T) {
		if err := f.store.MarkPhotoFailed(ctx, tripID, failed, "again"); err != nil {
			t.Fatal(err)
		}
		if p := photo(failed); p["status"] != "failed" || p["failureReason"] != "again" {
			t.Errorf("photo = %v", p)
		}
		if status, _ := retry("sub-ana", tripID, failed); status != http.StatusOK {
			t.Errorf("second retry after a second failure: %d", status)
		}
		if err := f.store.MarkPhotoReady(ctx, tripID, failed, store.Ready{TakenAt: "2026-11-06T10:00:00Z", Width: 4, Height: 3, ThumbKey: "media/x/t.webp", LargeKey: "media/x/l.webp"}); err != nil {
			t.Fatal(err)
		}
		if p := photo(failed); p["status"] != "ready" {
			t.Errorf("photo = %v", p)
		}
	})
}

func TestPhotoOrderWithFixedDates(t *testing.T) {
	// The clock is fixed at 2026-11-20 12:00: a Photo with no date taken sorts by that.
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	f.addMember(t, "sub-ana", "Ana")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	ctx := context.Background()
	// Uploaded by two Members, in an order unrelated to the dates.
	a := f.requestLinks(t, "sub-ana", tripID, jpeg("a.jpg", 10), jpeg("b.jpg", 10))
	b := f.requestLinks(t, "sub-leo", tripID, jpeg("c.jpg", 10), jpeg("d.jpg", 10), jpeg("e.jpg", 10))
	ids := []string{a[0]["photoId"].(string), a[1]["photoId"].(string), b[0]["photoId"].(string), b[1]["photoId"].(string), b[2]["photoId"].(string)}
	taken := []string{"2026-12-02T08:00:00Z", "2026-11-30T23:59:59Z", "2026-12-01T00:00:00Z", "", "2027-01-01T00:00:00Z"}
	for i, id := range ids {
		if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
			t.Fatal(err)
		}
		if taken[i] == "" {
			continue // d.jpg: no EXIF date, still processing: ordered by upload time
		}
		if err := f.store.MarkPhotoReady(ctx, tripID, id, store.Ready{TakenAt: taken[i], Width: 4, Height: 3, ThumbKey: "media/t.webp", LargeKey: "media/l.webp"}); err != nil {
			t.Fatal(err)
		}
	}
	got := []string{}
	for _, p := range photosOfTrip(t, f, tripID) {
		got = append(got, p["filename"].(string))
	}
	if want := "d.jpg,b.jpg,c.jpg,a.jpg,e.jpg"; strings.Join(got, ",") != want {
		t.Errorf("order = %v, want %s", got, want)
	}
	_, list := f.get(t, "sub-ana", "/api/trips")
	th := list["trips"].([]any)[0].(map[string]any)["thumbnails"].([]any)
	if len(th) != 4 {
		t.Errorf("thumbnails = %v", th)
	}
}

func TestRetryRestoresFailedWhenTheRequestIsCancelled(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	id := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10))[0]["photoId"].(string)
	ctx := context.Background()
	if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
		t.Fatal(err)
	}
	if err := f.store.MarkPhotoFailed(ctx, tripID, id, "corrupt image"); err != nil {
		t.Fatal(err)
	}
	f.wf.hold, f.wf.entered = true, make(chan struct{}, 1)

	reqCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, f.server.URL+"/api/trips/"+tripID+"/photos/"+id+"/retry", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(testSubHeader, "sub-leo")
	done := make(chan struct{})
	go func() {
		defer close(done)
		if res, err := http.DefaultClient.Do(req); err == nil {
			res.Body.Close()
		}
	}()
	<-f.wf.entered
	cancel() // the client gives up while the workflow is starting
	<-done

	deadline := time.Now().Add(5 * time.Second)
	for {
		var got map[string]any
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["id"] == id {
				got = p
			}
		}
		if got["status"] == "failed" && got["failureReason"] == "corrupt image" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("photo stranded after a cancelled retry: %v", got)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestStaleProcessingPhoto(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	id := f.requestLinks(t, "sub-leo", tripID, jpeg("a.jpg", 10))[0]["photoId"].(string)
	ctx := context.Background()
	if err := f.store.MarkPhotoProcessing(ctx, tripID, id); err != nil {
		t.Fatal(err)
	}
	photo := func() map[string]any {
		for _, p := range photosOfTrip(t, f, tripID) {
			if p["id"] == id {
				return p
			}
		}
		return nil
	}
	retry := func() (int, map[string]any) {
		return f.send(t, http.MethodPost, "sub-leo", "/api/trips/"+tripID+"/photos/"+id+"/retry", nil)
	}

	f.clock.Advance(14 * time.Minute)
	if p := photo(); p["status"] != "processing" {
		t.Fatalf("after 14 minutes: %v", p)
	}
	if status, body := retry(); status != http.StatusConflict || errorCode(body) != "photo-not-failed" {
		t.Errorf("retry of a fresh processing Photo: %d %v", status, body)
	}

	f.clock.Advance(2 * time.Minute)
	if p := photo(); p["status"] != "failed" || p["failureReason"] != "processing-timeout" {
		t.Fatalf("after 16 minutes the Photo should read as failed: %v", p)
	}
	// The Trip listing counts it as failed too, never as ready.
	if _, body := f.get(t, "sub-leo", "/api/trips/"+tripID); photosOf(body)[0]["status"] != "failed" {
		t.Errorf("trip detail: %v", body)
	}

	if status, body := retry(); status != http.StatusOK || body["status"] != "processing" {
		t.Fatalf("retry of a stale Photo: %d %v", status, body)
	}
	if len(f.wf.started()) != 1 {
		t.Errorf("started = %v", f.wf.started())
	}
	if p := photo(); p["status"] != "processing" {
		t.Errorf("after the retry: %v", p)
	}
	if status, _ := retry(); status != http.StatusConflict {
		t.Errorf("a second retry right after: %d", status)
	}

	f.clock.Advance(16 * time.Minute)
	if p := photo(); p["status"] != "failed" || p["failureReason"] != "processing-timeout" {
		t.Errorf("the clock restarts at each retry: %v", p)
	}
	// A late write from the slow execution still lands.
	if err := f.store.MarkPhotoReady(ctx, tripID, id, store.Ready{TakenAt: "2026-11-06T10:00:00Z", Width: 4, Height: 3, ThumbKey: "media/x/t.webp", LargeKey: "media/x/l.webp"}); err != nil {
		t.Fatal(err)
	}
	if p := photo(); p["status"] != "ready" {
		t.Errorf("late ready write: %v", p)
	}
}

func TestNewServerNeedsItsCollaborators(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("NewServer accepted a nil Workflow")
		}
	}()
	api.NewServer(api.Deps{})
}

func TestContentTypesAreCaseInsensitive(t *testing.T) {
	f := newFixtureWith(t, lifecycleStart, nil)
	f.addMember(t, "sub-leo", "Leo")
	tripID := f.createTrip(t, "sub-leo", trip("Lisboa", "2027-04-28", "2027-05-07"))
	res := f.requestLinks(t, "sub-leo", tripID,
		file{"filename": "a.heic", "contentType": "IMAGE/HEIC", "size": 10},
		file{"filename": "b.jpg", "contentType": "Image/Jpeg", "size": 10},
		file{"filename": "c.HEIC", "contentType": "Application/Octet-Stream", "size": 10},
	)
	for i, r := range res {
		if r["error"] != nil {
			t.Errorf("file %d refused: %v", i, r["error"])
		}
	}
	if res[2]["error"] == nil && res[2]["upload"] == nil {
		t.Error("no upload for c.HEIC")
	}
}
