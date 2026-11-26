// Package store keeps the Album's data in one DynamoDB table (ADR-0003).
//
// Item layout (the table and index are defined in infra/):
//
//	Member: pk = MEMBER#<id>, sk = PROFILE
//	Trip:   pk = TRIP#<id>,   sk = TRIP, gsi1pk = ALBUM, gsi1sk = <startDate>#<id>
//	Photo:  pk = TRIP#<tripId>, sk = PHOTO#<photoId>   (see photos.go)
//	Invitation: pk = TRIP#<tripId>, sk = INVITATION, gsi1pk = PENDING#<inviteeId> while Pending (see invitations.go)
//
// The generic index (gsi1) holds one partition per access pattern: ALBUM lists Trips by
// start date, PENDING#<inviteeId> lists Pending Invitations oldest first.
package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// AlbumIndex is the name of the generic secondary index (gsi1pk/gsi1sk).
const AlbumIndex = "gsi1"

const albumPartition = "ALBUM"

// ErrNotFound is returned when an item does not exist.
var ErrNotFound = errors.New("not found")

// Member is one of the two people who own the Album.
type Member struct {
	ID          string
	DisplayName string
}

// Trip is a journey the Members make together.
type Trip struct {
	ID          string
	Title       string
	Destination string
	StartDate   string // calendar date, YYYY-MM-DD
	EndDate     string // calendar date, YYYY-MM-DD
	Description string
	// CoverPhotoID is the Photo the Members chose as the Cover photo; empty when none was
	// chosen. It may name a Photo that no longer exists or is not ready: readers fall back.
	CoverPhotoID string
	// HiddenFrom is the Invitee of the Trip's Pending Invitation: the Trip is hidden from that
	// Member until they accept. Empty when the Trip has no Pending Invitation.
	HiddenFrom string
}

// VisibleTo reports whether the Member can see the Trip: every Trip except one whose
// Pending Invitation is for that Member.
func (t Trip) VisibleTo(memberID string) bool { return t.HiddenFrom != memberID }

// Store reads and writes the Album table.
type Store struct {
	db    *dynamodb.Client
	table string
	now   func() time.Time
}

// New returns a Store on the given table.
func New(db *dynamodb.Client, table string, opts ...Option) *Store {
	s := &Store{db: db, table: table, now: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

type memberItem struct {
	PK          string `dynamodbav:"pk"`
	SK          string `dynamodbav:"sk"`
	ID          string `dynamodbav:"id"`
	DisplayName string `dynamodbav:"displayName"`
}

type tripItem struct {
	PK           string `dynamodbav:"pk"`
	SK           string `dynamodbav:"sk"`
	GSI1PK       string `dynamodbav:"gsi1pk"`
	GSI1SK       string `dynamodbav:"gsi1sk"`
	ID           string `dynamodbav:"id"`
	Title        string `dynamodbav:"title"`
	Destination  string `dynamodbav:"destination"`
	StartDate    string `dynamodbav:"startDate"`
	EndDate      string `dynamodbav:"endDate"`
	Description  string `dynamodbav:"description,omitempty"`
	CoverPhotoID string `dynamodbav:"coverPhotoId,omitempty"`
	HiddenFrom   string `dynamodbav:"hiddenFrom,omitempty"`
}

func newTripItem(t Trip) tripItem {
	return tripItem{
		PK: "TRIP#" + t.ID, SK: "TRIP", GSI1PK: albumPartition, GSI1SK: t.StartDate + "#" + t.ID,
		ID: t.ID, Title: t.Title, Destination: t.Destination,
		StartDate: t.StartDate, EndDate: t.EndDate, Description: t.Description,
		HiddenFrom: t.HiddenFrom,
	}
}

func memberKey(id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: "MEMBER#" + id},
		"sk": &types.AttributeValueMemberS{Value: "PROFILE"},
	}
}

// PutMember creates or replaces a Member record.
func (s *Store) PutMember(ctx context.Context, m Member) error {
	if m.ID == "" || m.DisplayName == "" {
		return errors.New("member needs an id and a display name")
	}
	item, err := attributevalue.MarshalMap(memberItem{
		PK: "MEMBER#" + m.ID, SK: "PROFILE", ID: m.ID, DisplayName: m.DisplayName,
	})
	if err != nil {
		return fmt.Errorf("marshal member: %w", err)
	}
	if _, err := s.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.table),
		Item:      item,
	}); err != nil {
		return fmt.Errorf("put member: %w", err)
	}
	return nil
}

// GetMember returns the Member with the given id, or ErrNotFound.
func (s *Store) GetMember(ctx context.Context, id string) (Member, error) {
	out, err := s.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.table),
		Key:            memberKey(id),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return Member{}, fmt.Errorf("get member: %w", err)
	}
	if out.Item == nil {
		return Member{}, ErrNotFound
	}
	var it memberItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return Member{}, fmt.Errorf("unmarshal member: %w", err)
	}
	return Member{ID: it.ID, DisplayName: it.DisplayName}, nil
}

// ListTrips returns every Trip in the Album, newest start date first.
func (s *Store) ListTrips(ctx context.Context) ([]Trip, error) {
	trips := []Trip{}
	p := dynamodb.NewQueryPaginator(s.db, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		IndexName:              aws.String(AlbumIndex),
		KeyConditionExpression: aws.String("gsi1pk = :album"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":album": &types.AttributeValueMemberS{Value: albumPartition},
		},
		ScanIndexForward: aws.Bool(false),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list trips: %w", err)
		}
		var items []tripItem
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, fmt.Errorf("unmarshal trips: %w", err)
		}
		for _, it := range items {
			trips = append(trips, tripFromItem(it))
		}
	}
	return trips, nil
}

func tripKey(id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: "TRIP#" + id},
		"sk": &types.AttributeValueMemberS{Value: "TRIP"},
	}
}

func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("new id: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func tripFromItem(it tripItem) Trip {
	return Trip{
		ID: it.ID, Title: it.Title, Destination: it.Destination,
		StartDate: it.StartDate, EndDate: it.EndDate, Description: it.Description,
		CoverPhotoID: it.CoverPhotoID, HiddenFrom: it.HiddenFrom,
	}
}

// CreateTrip stores a new Trip and returns it with its generated id.
func (s *Store) CreateTrip(ctx context.Context, t Trip) (Trip, error) {
	id, err := newID()
	if err != nil {
		return Trip{}, err
	}
	t.ID, t.HiddenFrom = id, ""
	item, err := attributevalue.MarshalMap(newTripItem(t))
	if err != nil {
		return Trip{}, fmt.Errorf("marshal trip: %w", err)
	}
	if _, err := s.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(s.table),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(pk)"),
	}); err != nil {
		return Trip{}, fmt.Errorf("put trip: %w", err)
	}
	return t, nil
}

// GetTrip returns the Trip with the given id, or ErrNotFound.
func (s *Store) GetTrip(ctx context.Context, id string) (Trip, error) {
	out, err := s.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.table),
		Key:            tripKey(id),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return Trip{}, fmt.Errorf("get trip: %w", err)
	}
	if out.Item == nil {
		return Trip{}, ErrNotFound
	}
	var it tripItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return Trip{}, fmt.Errorf("unmarshal trip: %w", err)
	}
	return tripFromItem(it), nil
}

// UpdateTrip replaces every editable field of an existing Trip, or returns ErrNotFound.
// Other attributes of the item (added by later features) are left alone.
func (s *Store) UpdateTrip(ctx context.Context, t Trip) (Trip, error) {
	expr := "SET title = :title, destination = :dest, startDate = :start, endDate = :end, gsi1sk = :gsi1sk"
	vals := map[string]types.AttributeValue{
		":title":  &types.AttributeValueMemberS{Value: t.Title},
		":dest":   &types.AttributeValueMemberS{Value: t.Destination},
		":start":  &types.AttributeValueMemberS{Value: t.StartDate},
		":end":    &types.AttributeValueMemberS{Value: t.EndDate},
		":gsi1sk": &types.AttributeValueMemberS{Value: t.StartDate + "#" + t.ID},
	}
	if t.Description != "" {
		expr += ", description = :desc"
		vals[":desc"] = &types.AttributeValueMemberS{Value: t.Description}
	} else {
		expr += " REMOVE description"
	}
	out, err := s.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.table),
		Key:                       tripKey(t.ID),
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("attribute_exists(pk)"),
		ExpressionAttributeValues: vals,
		ReturnValues:              types.ReturnValueAllNew,
	})
	var cond *types.ConditionalCheckFailedException
	if errors.As(err, &cond) {
		return Trip{}, ErrNotFound
	}
	if err != nil {
		return Trip{}, fmt.Errorf("update trip: %w", err)
	}
	var it tripItem
	if err := attributevalue.UnmarshalMap(out.Attributes, &it); err != nil {
		return Trip{}, fmt.Errorf("decode updated trip: %w", err)
	}
	return tripFromItem(it), nil
}

// DeleteTrip removes a Trip together with its Invitation, if it has one, in one transaction
// (so a failure never leaves a Trip hidden by an Invitation that is gone), or returns
// ErrNotFound when the Trip does not exist.
func (s *Store) DeleteTrip(ctx context.Context, id string) error {
	_, err := s.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{
				TableName:           aws.String(s.table),
				Key:                 tripKey(id),
				ConditionExpression: aws.String("attribute_exists(pk)"),
			}},
			{Delete: &types.Delete{TableName: aws.String(s.table), Key: invitationKey(id)}},
		},
	})
	var cancelled *types.TransactionCanceledException
	if errors.As(err, &cancelled) {
		for _, r := range cancelled.CancellationReasons {
			if aws.ToString(r.Code) == "ConditionalCheckFailed" {
				return ErrNotFound
			}
		}
	}
	if err != nil {
		return fmt.Errorf("delete trip: %w", err)
	}
	return nil
}

// SetCoverPhoto records the Cover photo choice of an existing Trip, or returns ErrNotFound.
// It does not check the Photo: the API does, and readers fall back if the Photo is gone.
func (s *Store) SetCoverPhoto(ctx context.Context, tripID, photoID string) error {
	_, err := s.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.table),
		Key:                       tripKey(tripID),
		UpdateExpression:          aws.String("SET coverPhotoId = :p"),
		ConditionExpression:       aws.String("attribute_exists(pk)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":p": &types.AttributeValueMemberS{Value: photoID}},
	})
	var cond *types.ConditionalCheckFailedException
	if errors.As(err, &cond) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("set cover photo: %w", err)
	}
	return nil
}
