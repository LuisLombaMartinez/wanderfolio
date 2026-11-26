package api

import (
	"context"
	"errors"
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

// invitationSummaryJSON is what an Album card needs to mark a Trip that started with an Invitation.
type invitationSummaryJSON struct {
	// Status is "pending" or "accepted".
	Status string `json:"status"`
}

// toInvitationSummary is nil for a Trip without an Invitation. A Trip is Pending exactly while
// it is hidden from its Invitee (the list never shows a hidden Trip to the Invitee).
func toInvitationSummary(t store.Trip) *invitationSummaryJSON {
	switch {
	case t.InvitedBy == "":
		return nil
	case t.HiddenFrom != "":
		return &invitationSummaryJSON{Status: "pending"}
	}
	return &invitationSummaryJSON{Status: "accepted"}
}
