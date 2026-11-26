package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

const maxQuestionRunes = 120

// invitationInput is the "invitation" object of POST /api/trips.
type invitationInput struct {
	Question string `json:"question"`
}

// invitationJSON is an Invitation as the API shows it.
type invitationJSON struct {
	TripID    string `json:"tripId"`
	Question  string `json:"question"`
	InviterID string `json:"inviterId"`
	InviteeID string `json:"inviteeId"`
	// Status is "pending" or "accepted".
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	// AcceptedAt is null while Pending.
	AcceptedAt *string `json:"acceptedAt"`
}

// pendingInvitationJSON is one entry of the Pending list: the Invitation plus what the SPA
// needs to render it without reading the (still hidden) Trip.
type pendingInvitationJSON struct {
	invitationJSON
	Destination string `json:"destination"`
	StartDate   string `json:"startDate"`
	EndDate     string `json:"endDate"`
}

func toInvitationJSON(i store.Invitation) invitationJSON {
	j := invitationJSON{
		TripID: i.TripID, Question: i.Question, InviterID: i.InviterID, InviteeID: i.InviteeID,
		Status: "pending", CreatedAt: i.CreatedAt,
	}
	if !i.Pending() {
		at := i.AcceptedAt
		j.Status, j.AcceptedAt = "accepted", &at
	}
	return j
}

// validateQuestion trims an Invitation's question and checks it. It returns the question, or
// an error code and message (code is empty when the question is valid).
func validateQuestion(q string) (question, code, message string) {
	question = strings.TrimSpace(q)
	switch {
	case question == "":
		return question, "question-required", "an Invitation needs a question"
	case utf8.RuneCountInString(question) > maxQuestionRunes:
		return question, "question-too-long", "the question is too long"
	case hasControl(question, "") || hasInvisible(question):
		return question, "invalid-characters", "text fields cannot contain control characters"
	}
	return question, "", ""
}

// visibleTrip returns the Trip when the Member can see it, and store.ErrNotFound when it does
// not exist or is hidden from them (its Pending Invitation is for them): both look the same.
// Every Trip-scoped operation by a Member should load its Trip through here.
func (s *server) visibleTrip(ctx context.Context, id string, m store.Member) (store.Trip, error) {
	t, err := s.store.GetTrip(ctx, id)
	if err != nil {
		return store.Trip{}, err
	}
	if !t.VisibleTo(m.ID) {
		return store.Trip{}, store.ErrNotFound
	}
	return t, nil
}

// invitationFor returns the Trip's Invitation when the Member may read it (the Inviter at any
// time, either Member once Accepted), else nil.
func (s *server) invitationFor(ctx context.Context, tripID string, m store.Member) (*invitationJSON, error) {
	inv, err := s.store.GetInvitation(ctx, tripID)
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if inv.InviterID != m.ID && inv.Pending() {
		return nil, nil
	}
	j := toInvitationJSON(inv)
	return &j, nil
}

func (s *server) createTripWithInvitation(w http.ResponseWriter, r *http.Request, m store.Member, t store.Trip, question string) {
	invitee, err := s.store.OtherMember(r.Context(), m.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "invitee-missing", "there is no other Member to invite yet")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	created, inv, err := s.store.CreateTripWithInvitation(r.Context(), t, store.Invitation{
		InviterID: m.ID, InviteeID: invitee.ID, Question: question,
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	d := toTripDetailJSON(created, nil, nil)
	j := toInvitationJSON(inv)
	d.Invitation = &j
	writeJSON(w, http.StatusCreated, d)
}

// listPendingInvitations answers the current Member's Pending Invitations as Invitee, oldest first.
func (s *server) listPendingInvitations(w http.ResponseWriter, r *http.Request, m store.Member) {
	invs, err := s.store.ListPendingInvitations(r.Context(), m.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	out := make([]pendingInvitationJSON, 0, len(invs))
	for _, inv := range invs {
		t, err := s.store.GetTrip(r.Context(), inv.TripID)
		if errors.Is(err, store.ErrNotFound) {
			continue // the Trip is being deleted
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		if t.VisibleTo(m.ID) {
			continue // already accepted: the eventually consistent index has not caught up
		}
		out = append(out, pendingInvitationJSON{
			invitationJSON: toInvitationJSON(inv),
			Destination:    t.Destination, StartDate: t.StartDate, EndDate: t.EndDate,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"invitations": out})
}

// acceptInvitation records the Invitee's "Sí". It is the one Trip-scoped route the Invitee can
// reach while the Trip is hidden from them. Accepting again returns the first acceptance.
func (s *server) acceptInvitation(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID := r.PathValue("id")
	if !validID(tripID) {
		tripNotFound(w)
		return
	}
	if _, err := s.store.GetTrip(r.Context(), tripID); s.tripError(w, r, err) {
		return
	}
	inv, err := s.store.GetInvitation(r.Context(), tripID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "invitation-not-found", "this Trip has no Invitation")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if inv.InviteeID != m.ID {
		writeError(w, http.StatusForbidden, "not-the-invitee", "only the Invitee can accept an Invitation")
		return
	}
	inv, err = s.store.AcceptInvitation(r.Context(), tripID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "invitation-not-found", "this Trip has no Invitation")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toInvitationJSON(inv))
}

// inviterInvitation loads the Trip's Invitation for a route only its Inviter may use. It
// answers the error itself and returns false when the route must stop: the Trip is missing
// or hidden from the Member (404 trip-not-found), has no Invitation (404), or the Member is
// not the Inviter (403).
func (s *server) inviterInvitation(w http.ResponseWriter, r *http.Request, m store.Member) (store.Invitation, bool) {
	tripID := r.PathValue("id")
	if !validID(tripID) {
		tripNotFound(w)
		return store.Invitation{}, false
	}
	if _, err := s.visibleTrip(r.Context(), tripID, m); s.tripError(w, r, err) {
		return store.Invitation{}, false
	}
	inv, err := s.store.GetInvitation(r.Context(), tripID)
	if s.invitationError(w, r, err) {
		return store.Invitation{}, false
	}
	if inv.InviterID != m.ID {
		writeError(w, http.StatusForbidden, "not-the-inviter", "only the Inviter can change this Invitation")
		return store.Invitation{}, false
	}
	return inv, true
}

// invitationError answers a store error of an Invitation route and reports whether it did.
func (s *server) invitationError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "invitation-not-found", "this Trip has no Invitation")
	case errors.Is(err, store.ErrInvitationAccepted):
		writeError(w, http.StatusConflict, "invitation-accepted", "an accepted Invitation can no longer be changed")
	default:
		internalError(w, r, err)
	}
	return true
}

// getInvitation shows the Trip's Invitation to its Inviter at any time, and to the Invitee
// once Accepted. While Pending, the Invitee's Trip is hidden, so they get trip-not-found.
func (s *server) getInvitation(w http.ResponseWriter, r *http.Request, m store.Member) {
	tripID := r.PathValue("id")
	if !validID(tripID) {
		tripNotFound(w)
		return
	}
	if _, err := s.visibleTrip(r.Context(), tripID, m); s.tripError(w, r, err) {
		return
	}
	inv, err := s.invitationFor(r.Context(), tripID, m)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if inv == nil {
		writeError(w, http.StatusNotFound, "invitation-not-found", "this Trip has no Invitation")
		return
	}
	writeJSON(w, http.StatusOK, inv)
}

// updateInvitation changes the question of a Pending Invitation (Inviter only).
func (s *server) updateInvitation(w http.ResponseWriter, r *http.Request, m store.Member) {
	cur, ok := s.inviterInvitation(w, r, m)
	if !ok {
		return
	}
	if !cur.Pending() {
		s.invitationError(w, r, store.ErrInvitationAccepted)
		return
	}
	var in invitationInput
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
	q, code, msg := validateQuestion(in.Question)
	if code != "" {
		writeError(w, http.StatusUnprocessableEntity, code, msg)
		return
	}
	inv, err := s.store.UpdateInvitationQuestion(r.Context(), cur.TripID, q)
	if s.invitationError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, toInvitationJSON(inv))
}

// deleteInvitation removes a Pending Invitation and shows its Trip to the Invitee (Inviter only).
func (s *server) deleteInvitation(w http.ResponseWriter, r *http.Request, m store.Member) {
	cur, ok := s.inviterInvitation(w, r, m)
	if !ok {
		return
	}
	if !cur.Pending() {
		s.invitationError(w, r, store.ErrInvitationAccepted)
		return
	}
	if s.invitationError(w, r, s.store.DeleteInvitation(r.Context(), cur.TripID)) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
