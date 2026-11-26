package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

const (
	// maxUploadBytes is the biggest original S3 accepts (the presigned POST pins it).
	maxUploadBytes = 30 << 20
	// maxFilesPerRequest bounds one batch of upload links.
	maxFilesPerRequest = 50
	maxFilenameRunes   = 255
	maxThumbnails      = 4
	// mediaSessionTTL is how long the media cookies last; the SPA renews them before.
	mediaSessionTTL = 4 * time.Hour
)

// allowedTypes are the content types an original may have. HEIF/HEIC is what Samsung and
// Apple phones save; the Python step decodes it with pillow-heif.
var allowedTypes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true,
	"image/heic": true, "image/heif": true,
}

// extensionTypes maps a file extension to the type S3 pins when the browser reports none:
// browsers often leave a .heic file's type empty or application/octet-stream.
var extensionTypes = map[string]string{
	".heic": "image/heic", ".heif": "image/heif",
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}

// effectiveType is the content type an upload is pinned to: the reported one, or, when it is
// empty or the generic application/octet-stream, the one the file extension implies.
func effectiveType(f uploadFile) string {
	ct := strings.ToLower(strings.TrimSpace(f.ContentType))
	if ct == "" || ct == "application/octet-stream" {
		if t, ok := extensionTypes[strings.ToLower(path.Ext(f.Filename))]; ok {
			return t
		}
	}
	return ct
}

// originalKey is where a Photo's original lives in the photo bucket. The processing
// workflow parses the Trip and Photo ids back out of it.
func originalKey(tripID, photoID string) string { return "originals/" + tripID + "/" + photoID }

// mediaURL is the address the SPA uses for a generated version: the bucket key under /media.
func mediaURL(key string) string { return "/" + key }

type photoJSON struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Filename     string `json:"filename"`
	TakenAt      string `json:"takenAt,omitempty"`
	Width        int    `json:"width,omitempty"`
	Height       int    `json:"height,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	LargeURL     string `json:"largeUrl,omitempty"`
	Reason       string `json:"failureReason,omitempty"`
	Caption      string `json:"caption,omitempty"`
	// UploadedBy is the display name of the Member who uploaded the Photo.
	UploadedBy string `json:"uploadedBy,omitempty"`
}

func toPhotoJSON(p store.Photo, uploader string) photoJSON {
	j := photoJSON{
		ID: p.ID, Status: string(p.Status), Filename: p.Filename,
		TakenAt: p.TakenAt, Width: p.Width, Height: p.Height, Reason: p.Reason,
		Caption: p.Caption, UploadedBy: uploader,
	}
	if p.Status == store.PhotoReady {
		j.ThumbnailURL, j.LargeURL = mediaURL(p.ThumbKey), mediaURL(p.LargeKey)
	}
	return j
}

type uploadFile struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type uploadLinksInput struct {
	Files []uploadFile `json:"files"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// uploadResult answers one requested file: a Photo and its upload link, or why it was refused.
type uploadResult struct {
	Filename string        `json:"filename"`
	PhotoID  string        `json:"photoId,omitempty"`
	Upload   *media.Upload `json:"upload,omitempty"`
	Error    *apiError     `json:"error,omitempty"`
}

// checkFile returns the code and message why a file cannot be uploaded, or "" if it can.
func checkFile(f uploadFile) (code, msg string) {
	switch {
	case f.Filename == "" || utf8.RuneCountInString(f.Filename) > maxFilenameRunes || strings.ContainsFunc(f.Filename, unicode.IsControl):
		return "invalid-filename", "the file name is empty, too long or has control characters"
	case !allowedTypes[effectiveType(f)]:
		return "unsupported-file-type", "only JPEG, PNG, WebP and HEIF photos are accepted"
	case f.Size <= 0:
		return "empty-file", "the file is empty"
	case f.Size > maxUploadBytes:
		return "file-too-large", "a photo can be at most 30 MB"
	}
	return "", ""
}

func (s *server) uploadLinks(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID := r.PathValue("id")
	if !validID(tripID) {
		tripNotFound(w)
		return
	}
	var in uploadLinksInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid-body", "the request body is not valid JSON")
		return
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid-body", "the request body must be a single JSON object")
		return
	}
	switch {
	case len(in.Files) == 0:
		writeError(w, http.StatusUnprocessableEntity, "no-files", "list at least one file")
		return
	case len(in.Files) > maxFilesPerRequest:
		writeError(w, http.StatusUnprocessableEntity, "too-many-files", "too many files in one request")
		return
	}
	if _, err := s.visibleTrip(r.Context(), tripID, m); s.tripError(w, r, err) {
		return
	}

	// Check every file, generate every id and presign every link first; only then write the
	// records, all at once, so a failure leaves no awaiting-upload Photo behind.
	results := make([]uploadResult, len(in.Files))
	var accepted []store.Photo
	for i, f := range in.Files {
		results[i] = uploadResult{Filename: f.Filename}
		if code, msg := checkFile(f); code != "" {
			results[i].Error = &apiError{Code: code, Message: msg}
			continue
		}
		id, err := store.NewPhotoID()
		if err != nil {
			internalError(w, r, err)
			return
		}
		ct := effectiveType(f)
		up, err := s.Uploads.PresignUpload(r.Context(), originalKey(tripID, id), ct, maxUploadBytes)
		if err != nil {
			internalError(w, r, err)
			return
		}
		results[i].PhotoID, results[i].Upload = id, &up
		accepted = append(accepted, store.Photo{
			ID: id, TripID: tripID, Filename: f.Filename, ContentType: ct, Size: f.Size, UploadedBy: m.ID,
		})
	}
	if _, err := s.store.CreatePhotos(r.Context(), accepted); err != nil {
		s.tripError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// mediaSession sets the CloudFront signed cookies that unlock /media/* for a few hours.
func (s *server) mediaSession(w http.ResponseWriter, r *http.Request, _ store.Member) {
	expires := s.Now().Add(mediaSessionTTL)
	cookies, err := s.Cookies.Cookies(r.Context(), expires)
	if err != nil {
		internalError(w, r, err)
		return
	}
	for _, c := range cookies {
		http.SetCookie(w, c)
	}
	writeJSON(w, http.StatusOK, map[string]string{"expiresAt": expires.UTC().Format(time.RFC3339)})
}

// retryPhoto starts processing again for a failed Photo: the Photo goes back to processing and
// the workflow runs once more on its original. Only a failed Photo can be retried, and a Photo stuck in processing
// for longer than store.ProcessingTimeout (it reads as failed, see the store).
func (s *server) retryPhoto(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID, photoID := r.PathValue("id"), r.PathValue("photoId")
	if !validID(tripID) {
		tripNotFound(w)
		return
	}
	if !validID(photoID) {
		photoNotFound(w)
		return
	}
	if !s.photoTripVisible(w, r, m, tripID) {
		return
	}
	p, err := s.store.GetPhoto(r.Context(), tripID, photoID)
	if errors.Is(err, store.ErrNotFound) {
		photoNotFound(w)
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	moved, err := s.store.RetryPhoto(r.Context(), tripID, photoID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if !moved {
		// Not failed (ready, still processing, or a concurrent retry won) or deleted meanwhile.
		writeError(w, http.StatusConflict, "photo-not-failed", "only a failed photo can be retried")
		return
	}
	if err := s.Workflow.StartProcessing(r.Context(), originalKey(tripID, photoID)); err != nil {
		// The workflow did not start: put the Photo back to failed so it can be retried again.
		// The request may be cancelled (the client left), so the write must not depend on it.
		rctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		if rerr := s.store.MarkPhotoFailed(rctx, tripID, photoID, p.Reason); rerr != nil {
			slog.ErrorContext(r.Context(), "restore failed photo", "err", rerr)
		}
		internalError(w, r, err)
		return
	}
	p.Status, p.Reason = store.PhotoProcessing, ""
	// The workflow already started, so a failed name lookup only leaves the uploader out.
	names, err := s.uploaderNames(r.Context(), []store.Photo{p})
	if err != nil {
		slog.WarnContext(r.Context(), "uploader name lookup after retry", "err", err)
	}
	writeJSON(w, http.StatusOK, toPhotoJSON(p, names[p.UploadedBy]))
}

// uploaderNames maps the Member ids on the Photos to display names. A Member that cannot be
// found is left out (the Photo then has no uploader name).
func (s *server) uploaderNames(ctx context.Context, photos []store.Photo) (map[string]string, error) {
	names := map[string]string{}
	for _, p := range photos {
		if _, done := names[p.UploadedBy]; done || p.UploadedBy == "" {
			continue
		}
		m, err := s.store.GetMember(ctx, p.UploadedBy)
		if errors.Is(err, store.ErrNotFound) {
			names[p.UploadedBy] = ""
			continue
		}
		if err != nil {
			return nil, err
		}
		names[p.UploadedBy] = m.DisplayName
	}
	return names, nil
}

const maxCaptionRunes = 500

// validateCaption trims a caption and checks it (same rules as a Trip description: length,
// no control characters other than line breaks and tabs). Empty is valid and clears it.
func validateCaption(in string) (caption, code, message string) {
	caption = strings.TrimSpace(in)
	switch {
	case utf8.RuneCountInString(caption) > maxCaptionRunes:
		return "", "caption-too-long", "the caption is too long"
	case hasControl(caption, "\n\t\r"):
		return "", "invalid-characters", "text fields cannot contain control characters"
	}
	return caption, "", ""
}

func photoNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "photo-not-found", "no such Photo")
}

// photoTripVisible reports whether the Member can see the Trip a Photo route names. A Trip
// that is missing or hidden from them (its Pending Invitation is for them) answers the same
// 404 a missing Photo does, and the route goes no further.
func (s *server) photoTripVisible(w http.ResponseWriter, r *http.Request, m store.Member, tripID string) bool {
	_, err := s.visibleTrip(r.Context(), tripID, m)
	switch {
	case err == nil:
		return true
	case errors.Is(err, store.ErrNotFound):
		photoNotFound(w)
	default:
		internalError(w, r, err)
	}
	return false
}

// setCaption sets, edits or clears (empty string) a Photo's caption. Either Member may.
func (s *server) setCaption(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID, photoID := r.PathValue("id"), r.PathValue("photoId")
	if !validID(tripID) || !validID(photoID) {
		photoNotFound(w)
		return
	}
	var in struct {
		Caption *string `json:"caption"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil || in.Caption == nil {
		writeError(w, http.StatusBadRequest, "invalid-body", `the body must be {"caption": string}`)
		return
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid-body", "the request body must be a single JSON object")
		return
	}
	caption, code, msg := validateCaption(*in.Caption)
	if code != "" {
		writeError(w, http.StatusUnprocessableEntity, code, msg)
		return
	}
	if !s.photoTripVisible(w, r, m, tripID) {
		return
	}
	p, err := s.store.SetCaption(r.Context(), tripID, photoID, caption)
	if errors.Is(err, store.ErrNotFound) {
		photoNotFound(w)
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	names, err := s.uploaderNames(r.Context(), []store.Photo{p})
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toPhotoJSON(p, names[p.UploadedBy]))
}

// photoObjectKeys are every bucket key a Photo may have, whatever its state: the original and
// both web versions. Deleting a key that does not exist is fine, so a Photo that never got
// past awaiting-upload is handled the same as a ready one.
func photoObjectKeys(tripID, photoID string) []string {
	return []string{
		originalKey(tripID, photoID),
		"media/" + tripID + "/" + photoID + "/thumb.webp",
		"media/" + tripID + "/" + photoID + "/large.webp",
	}
}

// deletePhoto deletes a Photo in any state: its bucket objects first, then its record. In
// that order a failure half-way is safe to retry (the Photo still shows, the DELETE can be
// repeated). The bucket is versioned, so the originals stay recoverable for 30 days.
func (s *server) deletePhoto(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID, photoID := r.PathValue("id"), r.PathValue("photoId")
	if !validID(tripID) || !validID(photoID) {
		photoNotFound(w)
		return
	}
	if !s.photoTripVisible(w, r, m, tripID) {
		return
	}
	if _, err := s.store.GetPhoto(r.Context(), tripID, photoID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			photoNotFound(w)
			return
		}
		internalError(w, r, err)
		return
	}
	if err := s.Objects.DeleteObjects(r.Context(), photoObjectKeys(tripID, photoID)); err != nil {
		internalError(w, r, err)
		return
	}
	if err := s.store.DeletePhoto(r.Context(), tripID, photoID); err != nil && !errors.Is(err, store.ErrNotFound) {
		internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// removeTrip deletes a Trip with all its Photos and its Invitation: bucket objects in batches of 1000 keys,
// Photo records in batches of 25 (a few at once), and the Trip record last, so a failure
// half-way leaves the Trip in place and the DELETE can simply be repeated. 200 Photos are
// 600 keys (one S3 call) and 8 DynamoDB batches: well inside the 10 s Lambda timeout.
func (s *server) removeTrip(ctx context.Context, tripID string) error {
	if _, err := s.store.GetTrip(ctx, tripID); err != nil {
		return err
	}
	ids, err := s.store.ListPhotoIDs(ctx, tripID)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(ids)*3)
	for _, id := range ids {
		keys = append(keys, photoObjectKeys(tripID, id)...)
	}
	if err := s.Objects.DeleteObjects(ctx, keys); err != nil {
		return err
	}
	if err := s.store.DeletePhotos(ctx, tripID, ids); err != nil {
		return err
	}
	// DeleteTrip removes the Invitation with the Trip, in one transaction.
	return s.store.DeleteTrip(ctx, tripID)
}
