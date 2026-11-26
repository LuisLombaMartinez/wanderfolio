package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Invitation is the playful question one Member sends the other to invite them on a Trip.
// A Trip has at most one, added only when the Trip is created.
//
// Item: pk = TRIP#<tripId>, sk = INVITATION. While Pending it also carries
// gsi1pk = PENDING#<inviteeId>, gsi1sk = <createdAt>#<tripId> (the Pending index, oldest
// first); accepting removes both, so the index only ever holds Pending Invitations.
// While Pending, the Trip item carries hiddenFrom = <inviteeId> (see Trip.HiddenFrom); the
// two items are written together in one transaction.
type Invitation struct {
	TripID    string
	InviterID string
	InviteeID string
	Question  string
	CreatedAt string // invitationTimeLayout
	// AcceptedAt is when the Invitee said "Sí" (invitationTimeLayout); empty while Pending.
	AcceptedAt string
}

// Pending reports whether the Invitee has not accepted yet.
func (i Invitation) Pending() bool { return i.AcceptedAt == "" }

// invitationTimeLayout has milliseconds so Invitations made in the same second still sort
// by creation. UTC and fixed width, so the strings sort as times.
const invitationTimeLayout = "2006-01-02T15:04:05.000Z"

const invitationSK = "INVITATION"

func pendingPartition(inviteeID string) string { return "PENDING#" + inviteeID }

type invitationItem struct {
	PK         string `dynamodbav:"pk"`
	SK         string `dynamodbav:"sk"`
	GSI1PK     string `dynamodbav:"gsi1pk,omitempty"`
	GSI1SK     string `dynamodbav:"gsi1sk,omitempty"`
	TripID     string `dynamodbav:"tripId"`
	InviterID  string `dynamodbav:"inviterId"`
	InviteeID  string `dynamodbav:"inviteeId"`
	Question   string `dynamodbav:"question"`
	CreatedAt  string `dynamodbav:"createdAt"`
	AcceptedAt string `dynamodbav:"acceptedAt,omitempty"`
}

func invitationKey(tripID string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": str("TRIP#" + tripID),
		"sk": str(invitationSK),
	}
}

func invitationFromItem(it invitationItem) Invitation {
	return Invitation{
		TripID: it.TripID, InviterID: it.InviterID, InviteeID: it.InviteeID,
		Question: it.Question, CreatedAt: it.CreatedAt, AcceptedAt: it.AcceptedAt,
	}
}

// OtherMember returns the Member who is not id (there are exactly two), or ErrNotFound when
// the other Member has no record yet. Member records have no index of their own, so this
// scans the table for them (eventually consistent: Members are written once, long before);
// it runs only when a Trip is created with an Invitation.
// Debt: the scan reads the whole table; a MEMBERS partition on gsi1, written by PutMember,
// would make it a single Query.
func (s *Store) OtherMember(ctx context.Context, id string) (Member, error) {
	p := dynamodb.NewScanPaginator(s.db, &dynamodb.ScanInput{
		TableName:                 aws.String(s.table),
		FilterExpression:          aws.String("sk = :profile AND begins_with(pk, :member) AND id <> :me"),
		ProjectionExpression:      aws.String("id, displayName"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":profile": str("PROFILE"), ":member": str("MEMBER#"), ":me": str(id)},
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return Member{}, fmt.Errorf("find other member: %w", err)
		}
		if len(page.Items) > 0 {
			var it memberItem
			if err := attributevalue.UnmarshalMap(page.Items[0], &it); err != nil {
				return Member{}, fmt.Errorf("unmarshal member: %w", err)
			}
			return Member{ID: it.ID, DisplayName: it.DisplayName}, nil
		}
	}
	return Member{}, ErrNotFound
}

// CreateTripWithInvitation stores a new Trip together with its Pending Invitation, in one
// all-or-nothing write. The Trip is hidden from the Invitee until they accept. inv needs
// InviterID, InviteeID and Question; the rest is filled in.
func (s *Store) CreateTripWithInvitation(ctx context.Context, t Trip, inv Invitation) (Trip, Invitation, error) {
	id, err := newID()
	if err != nil {
		return Trip{}, Invitation{}, err
	}
	t.ID, t.HiddenFrom = id, inv.InviteeID
	inv.TripID, inv.CreatedAt, inv.AcceptedAt = id, s.now().UTC().Format(invitationTimeLayout), ""
	tripAV, err := attributevalue.MarshalMap(newTripItem(t))
	if err != nil {
		return Trip{}, Invitation{}, fmt.Errorf("marshal trip: %w", err)
	}
	invAV, err := attributevalue.MarshalMap(invitationItem{
		PK: "TRIP#" + id, SK: invitationSK,
		GSI1PK: pendingPartition(inv.InviteeID), GSI1SK: inv.CreatedAt + "#" + id,
		TripID: id, InviterID: inv.InviterID, InviteeID: inv.InviteeID,
		Question: inv.Question, CreatedAt: inv.CreatedAt,
	})
	if err != nil {
		return Trip{}, Invitation{}, fmt.Errorf("marshal invitation: %w", err)
	}
	cond := aws.String("attribute_not_exists(pk)")
	if _, err := s.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: aws.String(s.table), Item: tripAV, ConditionExpression: cond}},
			{Put: &types.Put{TableName: aws.String(s.table), Item: invAV, ConditionExpression: cond}},
		},
	}); err != nil {
		return Trip{}, Invitation{}, fmt.Errorf("put trip with invitation: %w", err)
	}
	return t, inv, nil
}

// GetInvitation returns the Invitation of a Trip, or ErrNotFound when it has none.
func (s *Store) GetInvitation(ctx context.Context, tripID string) (Invitation, error) {
	out, err := s.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.table),
		Key:            invitationKey(tripID),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return Invitation{}, fmt.Errorf("get invitation: %w", err)
	}
	if out.Item == nil {
		return Invitation{}, ErrNotFound
	}
	var it invitationItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return Invitation{}, fmt.Errorf("unmarshal invitation: %w", err)
	}
	return invitationFromItem(it), nil
}

// ListPendingInvitations returns the Pending Invitations for the given Invitee, oldest first.
// The index is eventually consistent, so an Invitation accepted a moment ago may still show;
// accepting it again is a no-op.
func (s *Store) ListPendingInvitations(ctx context.Context, inviteeID string) ([]Invitation, error) {
	out := []Invitation{}
	p := dynamodb.NewQueryPaginator(s.db, &dynamodb.QueryInput{
		TableName:                 aws.String(s.table),
		IndexName:                 aws.String(AlbumIndex),
		KeyConditionExpression:    aws.String("gsi1pk = :p"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":p": str(pendingPartition(inviteeID))},
		ScanIndexForward:          aws.Bool(true),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list pending invitations: %w", err)
		}
		var items []invitationItem
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, fmt.Errorf("unmarshal invitations: %w", err)
		}
		for _, it := range items {
			out = append(out, invitationFromItem(it))
		}
	}
	return out, nil
}

// AcceptInvitation records the Invitee's "Sí" on a Pending Invitation and reveals its Trip,
// in one transaction, and returns the Invitation. An Invitation that is already Accepted is
// returned unchanged (accepting is idempotent). ErrNotFound when the Trip has no Invitation.
// The caller checks that the Member is the Invitee.
func (s *Store) AcceptInvitation(ctx context.Context, tripID string) (Invitation, error) {
	inv, err := s.GetInvitation(ctx, tripID)
	if err != nil || !inv.Pending() {
		return inv, err
	}
	at := s.now().UTC().Format(invitationTimeLayout)
	_, err = s.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Update: &types.Update{
				TableName:                 aws.String(s.table),
				Key:                       invitationKey(tripID),
				UpdateExpression:          aws.String("SET acceptedAt = :at REMOVE gsi1pk, gsi1sk"),
				ConditionExpression:       aws.String("attribute_exists(pk) AND attribute_not_exists(acceptedAt)"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":at": str(at)},
			}},
			{Update: &types.Update{
				TableName:           aws.String(s.table),
				Key:                 tripKey(tripID),
				UpdateExpression:    aws.String("REMOVE hiddenFrom"),
				ConditionExpression: aws.String("attribute_exists(pk)"),
			}},
		},
	})
	var cancelled *types.TransactionCanceledException
	if errors.As(err, &cancelled) {
		switch acceptCancellation(cancelled.CancellationReasons) {
		case acceptTripGone:
			return Invitation{}, ErrNotFound
		case acceptAlreadyDone:
			// Accepted at the same moment by another request: return what is stored.
			cur, gerr := s.GetInvitation(ctx, tripID)
			if gerr != nil || !cur.Pending() {
				return cur, gerr
			}
		}
		return Invitation{}, fmt.Errorf("accept invitation: %w", err)
	}
	if err != nil {
		return Invitation{}, fmt.Errorf("accept invitation: %w", err)
	}
	inv.AcceptedAt = at
	return inv, nil
}

type acceptOutcome int

const (
	acceptFailed      acceptOutcome = iota // any other reason: conflict, throttling, ...
	acceptAlreadyDone                      // the Invitation was already Accepted (or is gone)
	acceptTripGone                         // the Trip no longer exists
)

// acceptCancellation reads why the accept transaction was cancelled. The reasons line up
// with its items: the Invitation update first, then the Trip update.
func acceptCancellation(reasons []types.CancellationReason) acceptOutcome {
	failed := func(i int) bool {
		return i < len(reasons) && aws.ToString(reasons[i].Code) == "ConditionalCheckFailed"
	}
	switch {
	case failed(1):
		return acceptTripGone
	case failed(0):
		return acceptAlreadyDone
	}
	return acceptFailed
}
