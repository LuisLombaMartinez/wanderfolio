// Package api is the Album's JSON HTTP API, served under /api.
//
// It never validates tokens: API Gateway's JWT authorizer does that, and the
// Lambda adapter puts the verified claims into the request context with
// claims.With. A request without claims is refused; there is no bypass.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/claims"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/media"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

// Store is what the API needs from persistence.
type Store interface {
	GetMember(ctx context.Context, id string) (store.Member, error)
	ListTrips(ctx context.Context) ([]store.Trip, error)
	CreateTrip(ctx context.Context, t store.Trip) (store.Trip, error)
	GetTrip(ctx context.Context, id string) (store.Trip, error)
	UpdateTrip(ctx context.Context, t store.Trip) (store.Trip, error)
	DeleteTrip(ctx context.Context, id string) error
	CreatePhotos(ctx context.Context, photos []store.Photo) ([]store.Photo, error)
	ListPhotos(ctx context.Context, tripID string) ([]store.Photo, error)
	GetPhoto(ctx context.Context, tripID, id string) (store.Photo, error)
	SetCoverPhoto(ctx context.Context, tripID, photoID string) error
	ListPhotoSummaries(ctx context.Context, tripID string) ([]store.Photo, error)
	RetryPhoto(ctx context.Context, tripID, id string) (bool, error)
	MarkPhotoFailed(ctx context.Context, tripID, id, reason string) error
	SetCaption(ctx context.Context, tripID, id, caption string) (store.Photo, error)
	DeletePhoto(ctx context.Context, tripID, id string) error
	ListPhotoIDs(ctx context.Context, tripID string) ([]string, error)
	DeletePhotos(ctx context.Context, tripID string, ids []string) error
}

// Workflow starts the photo-processing workflow.
type Workflow interface {
	// StartProcessing runs the workflow on the original stored at the given bucket key.
	StartProcessing(ctx context.Context, key string) error
}

// Objects deletes objects of the photo bucket.
type Objects interface {
	DeleteObjects(ctx context.Context, keys []string) error
}

// Uploads issues presigned POSTs to the photo bucket.
type Uploads interface {
	PresignUpload(ctx context.Context, key, contentType string, maxBytes int64) (media.Upload, error)
}

// Cookies issues the CloudFront signed cookies for /media/*.
type Cookies interface {
	Cookies(ctx context.Context, expires time.Time) ([]*http.Cookie, error)
}

// Deps are the API's collaborators.
type Deps struct {
	Store   Store
	Uploads Uploads
	Objects Objects
	Cookies Cookies
	// Workflow starts photo processing (retry of a failed Photo).
	Workflow Workflow
	// Now is the clock; nil means time.Now.
	Now func() time.Time
}

type server struct {
	Deps
	store Store
}

// NewServer returns the API's HTTP handler.
func NewServer(d Deps) http.Handler {
	if d.Store == nil || d.Uploads == nil || d.Objects == nil || d.Cookies == nil || d.Workflow == nil {
		panic("api.NewServer: Store, Uploads, Objects, Cookies and Workflow are required")
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	s := &server{Deps: d, store: d.Store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/me", s.withMember(s.currentMember))
	mux.HandleFunc("GET /api/trips", s.withMember(s.listTrips))
	mux.HandleFunc("POST /api/trips", s.withMember(s.createTrip))
	mux.HandleFunc("GET /api/trips/{id}", s.withMember(s.getTrip))
	mux.HandleFunc("PUT /api/trips/{id}", s.withMember(s.updateTrip))
	mux.HandleFunc("DELETE /api/trips/{id}", s.withMember(s.deleteTrip))
	mux.HandleFunc("POST /api/trips/{id}/photos/upload-links", s.withMember(s.uploadLinks))
	mux.HandleFunc("PUT /api/trips/{id}/cover-photo", s.withMember(s.setCoverPhoto))
	mux.HandleFunc("POST /api/trips/{id}/photos/{photoId}/retry", s.withMember(s.retryPhoto))
	mux.HandleFunc("PATCH /api/trips/{id}/photos/{photoId}", s.withMember(s.setCaption))
	mux.HandleFunc("DELETE /api/trips/{id}/photos/{photoId}", s.withMember(s.deletePhoto))
	mux.HandleFunc("POST /api/media-session", s.withMember(s.mediaSession))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not-found", "no such route")
	})
	return mux
}

type memberHandler func(w http.ResponseWriter, r *http.Request, m store.Member)

// withMember resolves the calling Member from the forwarded claims.
func (s *server) withMember(next memberHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := claims.Subject(r.Context())
		if sub == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "login required")
			return
		}
		m, err := s.store.GetMember(r.Context(), sub)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusForbidden, "not-a-member", "this login is not a Member")
			return
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		next(w, r, m)
	}
}

type memberJSON struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

func (s *server) currentMember(w http.ResponseWriter, _ *http.Request, m store.Member) {
	writeJSON(w, http.StatusOK, memberJSON{ID: m.ID, DisplayName: m.DisplayName})
}

type tripJSON struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Destination string `json:"destination"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
	Description string `json:"description,omitempty"`
	// PhotoCount is the number of ready Photos.
	PhotoCount int `json:"photoCount"`
	// Thumbnails are addresses of the first ready Photos' thumbnails, in date-taken order (at most maxThumbnails).
	Thumbnails []string `json:"thumbnails"`
	// CoverPhoto is the Trip's Cover photo: the chosen ready Photo, else the first ready Photo in
	// date-taken order; null when the Trip has no ready Photo.
	CoverPhoto *coverPhotoJSON `json:"coverPhoto"`
}

type coverPhotoJSON struct {
	ID           string `json:"id"`
	ThumbnailURL string `json:"thumbnailUrl"`
	LargeURL     string `json:"largeUrl"`
	// Chosen is false when this is the fallback (no choice, or the chosen Photo is gone or not ready).
	Chosen bool `json:"chosen"`
}

// tripDetailJSON is a Trip with all its Photos, ordered by date taken.
type tripDetailJSON struct {
	tripJSON
	Photos []photoJSON `json:"photos"`
}

func newCover(p store.Photo, chosen bool) *coverPhotoJSON {
	return &coverPhotoJSON{ID: p.ID, ThumbnailURL: mediaURL(p.ThumbKey), LargeURL: mediaURL(p.LargeKey), Chosen: chosen}
}

func toTripJSON(t store.Trip, photos []store.Photo) tripJSON {
	j := tripJSON{
		ID: t.ID, Title: t.Title, Destination: t.Destination,
		StartDate: t.StartDate, EndDate: t.EndDate, Description: t.Description,
		Thumbnails: []string{},
	}
	var chosen *coverPhotoJSON
	for _, p := range photos {
		if p.Status != store.PhotoReady {
			continue
		}
		j.PhotoCount++
		if j.CoverPhoto == nil {
			j.CoverPhoto = newCover(p, false)
		}
		if t.CoverPhotoID != "" && p.ID == t.CoverPhotoID {
			chosen = newCover(p, true)
		}
		if len(j.Thumbnails) < maxThumbnails {
			j.Thumbnails = append(j.Thumbnails, mediaURL(p.ThumbKey))
		}
	}
	// Computed at read time from the ready Photos, so a deleted or unfinished chosen Photo falls back.
	if chosen != nil {
		j.CoverPhoto = chosen
	}
	return j
}

func toTripDetailJSON(t store.Trip, photos []store.Photo, names map[string]string) tripDetailJSON {
	d := tripDetailJSON{tripJSON: toTripJSON(t, photos), Photos: make([]photoJSON, 0, len(photos))}
	for _, p := range photos {
		d.Photos = append(d.Photos, toPhotoJSON(p, names[p.UploadedBy]))
	}
	return d
}

func (s *server) listTrips(w http.ResponseWriter, r *http.Request, _ store.Member) {
	trips, err := s.store.ListTrips(r.Context())
	if err != nil {
		internalError(w, r, err)
		return
	}
	out := make([]tripJSON, 0, len(trips))
	for _, t := range trips {
		photos, err := s.store.ListPhotoSummaries(r.Context(), t.ID)
		if err != nil {
			internalError(w, r, err)
			return
		}
		out = append(out, toTripJSON(t, photos))
	}
	writeJSON(w, http.StatusOK, map[string]any{"trips": out})
}

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// writeError sends the API's single error shape. The SPA maps Code to Spanish copy.
func writeError(w http.ResponseWriter, status int, code, message string) {
	var b errorBody
	b.Error.Code = code
	b.Error.Message = message
	writeJSON(w, status, b)
}

func internalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "something went wrong")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write response", "err", err)
	}
}

const (
	maxBodyBytes       = 64 << 10
	maxTitleRunes      = 120
	maxDestinationRune = 120
	maxDescriptionRune = 2000
	dateLayout         = "2006-01-02"
)

// tripInput is the body of POST and PUT /api/trips. A Trip's id comes from the path.
type tripInput struct {
	Title       string `json:"title"`
	Destination string `json:"destination"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
	Description string `json:"description"`
}

// readTrip decodes and validates a Trip body, writing the error response itself on failure.
func readTrip(w http.ResponseWriter, r *http.Request) (store.Trip, bool) {
	var in tripInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid-body", "the request body is not valid JSON")
		return store.Trip{}, false
	}
	// Anything after the first JSON value is refused.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid-body", "the request body must be a single JSON object")
		return store.Trip{}, false
	}
	t, code, msg := validateTrip(in)
	if code != "" {
		writeError(w, http.StatusUnprocessableEntity, code, msg)
		return store.Trip{}, false
	}
	return t, true
}

// validateTrip trims and checks a Trip body. It returns the Trip, or an error code and
// message (code is empty when the Trip is valid).
func validateTrip(in tripInput) (t store.Trip, code, message string) {
	t = store.Trip{
		Title:       strings.TrimSpace(in.Title),
		Destination: strings.TrimSpace(in.Destination),
		StartDate:   in.StartDate,
		EndDate:     in.EndDate,
		Description: strings.TrimSpace(in.Description),
	}
	switch {
	case t.Title == "":
		return t, "title-required", "a Trip needs a title"
	case t.Destination == "":
		return t, "destination-required", "a Trip needs a destination"
	case utf8.RuneCountInString(t.Title) > maxTitleRunes:
		return t, "title-too-long", "the title is too long"
	case utf8.RuneCountInString(t.Destination) > maxDestinationRune:
		return t, "destination-too-long", "the destination is too long"
	case utf8.RuneCountInString(t.Description) > maxDescriptionRune:
		return t, "description-too-long", "the description is too long"
	case hasControl(t.Title, "") || hasControl(t.Destination, "") || hasControl(t.Description, "\n\t\r"):
		return t, "invalid-characters", "text fields cannot contain control characters"
	}
	start, errS := time.Parse(dateLayout, t.StartDate)
	end, errE := time.Parse(dateLayout, t.EndDate)
	switch {
	case errS != nil || errE != nil:
		return t, "invalid-date", "dates must be YYYY-MM-DD"
	case end.Before(start):
		return t, "end-before-start", "a Trip cannot end before it starts"
	}
	return t, "", ""
}

// hasControl reports whether s has a control character other than the allowed ones.
func hasControl(s, allowed string) bool {
	for _, r := range s {
		if unicode.IsControl(r) && !strings.ContainsRune(allowed, r) {
			return true
		}
	}
	return false
}

// validID reports whether id looks like an id the store generates (32 hex chars).
func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func tripNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "trip-not-found", "no such Trip")
}

func (s *server) createTrip(w http.ResponseWriter, r *http.Request, _ store.Member) {
	t, ok := readTrip(w, r)
	if !ok {
		return
	}
	created, err := s.store.CreateTrip(r.Context(), t)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, toTripDetailJSON(created, nil, nil))
}

func (s *server) getTrip(w http.ResponseWriter, r *http.Request, _ store.Member) {
	if !validID(r.PathValue("id")) {
		tripNotFound(w)
		return
	}
	t, err := s.store.GetTrip(r.Context(), r.PathValue("id"))
	if s.tripError(w, r, err) {
		return
	}
	s.writeTrip(w, r, t)
}

// writeTrip answers 200 with the Trip and its Photos.
func (s *server) writeTrip(w http.ResponseWriter, r *http.Request, t store.Trip) {
	photos, err := s.store.ListPhotos(r.Context(), t.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	names, err := s.uploaderNames(r.Context(), photos)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toTripDetailJSON(t, photos, names))
}

func (s *server) updateTrip(w http.ResponseWriter, r *http.Request, _ store.Member) {
	if !validID(r.PathValue("id")) {
		tripNotFound(w)
		return
	}
	t, ok := readTrip(w, r)
	if !ok {
		return
	}
	t.ID = r.PathValue("id")
	// UpdateTrip returns the stored Trip, including the Cover photo choice it leaves alone.
	updated, err := s.store.UpdateTrip(r.Context(), t)
	if s.tripError(w, r, err) {
		return
	}
	s.writeTrip(w, r, updated)
}

func (s *server) deleteTrip(w http.ResponseWriter, r *http.Request, _ store.Member) {
	if !validID(r.PathValue("id")) {
		tripNotFound(w)
		return
	}
	if s.tripError(w, r, s.removeTrip(r.Context(), r.PathValue("id"))) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// tripError answers a store error and reports whether it did.
func (s *server) tripError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		tripNotFound(w)
	default:
		internalError(w, r, err)
	}
	return true
}

// setCoverPhoto marks a ready Photo of the Trip as its Cover photo.
func (s *server) setCoverPhoto(w http.ResponseWriter, r *http.Request, _ store.Member) {
	tripID := r.PathValue("id")
	if !validID(tripID) {
		tripNotFound(w)
		return
	}
	var in struct {
		PhotoID string `json:"photoId"`
	}
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
	if in.PhotoID == "" {
		writeError(w, http.StatusBadRequest, "invalid-body", "photoId is required")
		return
	}
	t, err := s.store.GetTrip(r.Context(), tripID)
	if s.tripError(w, r, err) {
		return
	}
	if !validID(in.PhotoID) {
		writeError(w, http.StatusNotFound, "photo-not-found", "no such Photo in this Trip")
		return
	}
	p, err := s.store.GetPhoto(r.Context(), tripID, in.PhotoID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "photo-not-found", "no such Photo in this Trip")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if p.Status != store.PhotoReady {
		writeError(w, http.StatusConflict, "photo-not-ready", "only a ready Photo can be the Cover photo")
		return
	}
	if s.tripError(w, r, s.store.SetCoverPhoto(r.Context(), tripID, p.ID)) {
		return
	}
	t.CoverPhotoID = p.ID
	s.writeTrip(w, r, t)
}
