package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"golang.org/x/sync/errgroup"
)

// PhotoStatus is where a Photo is in its lifecycle.
type PhotoStatus string

// Photo states. A Photo is awaiting-upload when its upload link is issued, processing once
// the original has arrived, and ready when its web versions exist. failed is set by the
// processing workflow's Catch.
const (
	PhotoAwaitingUpload PhotoStatus = "awaiting-upload"
	PhotoProcessing     PhotoStatus = "processing"
	PhotoReady          PhotoStatus = "ready"
	PhotoFailed         PhotoStatus = "failed"
)

// AwaitingUploadTTL is how long an awaiting-upload Photo lives before it expires.
const AwaitingUploadTTL = 24 * time.Hour

// timeLayout is the one format of every timestamp on a Photo (UTC, fixed width, so
// strings sort as times). The Python processing steps write takenAt in the same format.
const timeLayout = "2006-01-02T15:04:05Z"

// ProcessingTimeout is how long a Photo may stay processing. Past it the Photo reads as
// failed with reason ProcessingTimeoutReason (decided at read time, nothing is written) and
// can be retried: the workflow that should have finished it is considered lost.
const ProcessingTimeout = 15 * time.Minute

// ProcessingTimeoutReason is the failure reason of a Photo that has been processing too long.
const ProcessingTimeoutReason = "processing-timeout"

// Photo is an image of a Trip uploaded by a Member.
type Photo struct {
	ID          string
	TripID      string
	Status      PhotoStatus
	Filename    string
	ContentType string
	Size        int64
	UploadedBy  string // Member id
	CreatedAt   string // timeLayout
	TakenAt     string // timeLayout; empty until processing has read it
	Width       int
	Height      int
	ThumbKey    string // S3 key of the ~400 px WebP, set when ready
	LargeKey    string // S3 key of the ~2048 px WebP, set when ready
	Reason      string // why processing failed
	Caption     string // optional, set by either Member
	// ProcessingSince is when the Photo last entered processing (timeLayout); empty otherwise.
	ProcessingSince string
}

// readAs applies the staleness rule: a processing Photo older than ProcessingTimeout reads as
// failed. A processing Photo with no processingSince (written before the rule) is left alone.
func (s *Store) readAs(p Photo) Photo {
	if p.Status == PhotoProcessing && p.ProcessingSince != "" &&
		p.ProcessingSince < s.now().UTC().Add(-ProcessingTimeout).Format(timeLayout) {
		p.Status, p.Reason = PhotoFailed, ProcessingTimeoutReason
	}
	return p
}

// SortTime is the time a Photo is ordered by: date taken, else when it was created.
func (p Photo) SortTime() string {
	if p.TakenAt != "" {
		return p.TakenAt
	}
	return p.CreatedAt
}

// Ready are the results of processing an original.
type Ready struct {
	TakenAt  string // timeLayout
	Width    int
	Height   int
	ThumbKey string
	LargeKey string
}

// Option configures a Store.
type Option func(*Store)

// WithClock replaces the store's clock (tests use it to move past a TTL).
func WithClock(now func() time.Time) Option {
	return func(s *Store) { s.now = now }
}

// photoItem is the Photo record: pk = TRIP#<tripId>, sk = PHOTO#<photoId>.
// The Python processing steps write status, expiresAt, takenAt, width, height,
// thumbKey, largeKey and failureReason on this item directly (see handoff).
type photoItem struct {
	PK          string `dynamodbav:"pk"`
	SK          string `dynamodbav:"sk"`
	ID          string `dynamodbav:"id"`
	TripID      string `dynamodbav:"tripId"`
	Status      string `dynamodbav:"status"`
	Filename    string `dynamodbav:"filename"`
	ContentType string `dynamodbav:"contentType"`
	Size        int64  `dynamodbav:"size"`
	UploadedBy  string `dynamodbav:"uploadedBy"`
	CreatedAt   string `dynamodbav:"createdAt"`
	ExpiresAt   int64  `dynamodbav:"expiresAt,omitempty"` // epoch seconds: the table's TTL attribute
	TakenAt     string `dynamodbav:"takenAt,omitempty"`
	Width       int    `dynamodbav:"width,omitempty"`
	Height      int    `dynamodbav:"height,omitempty"`
	ThumbKey    string `dynamodbav:"thumbKey,omitempty"`
	LargeKey    string `dynamodbav:"largeKey,omitempty"`
	Reason      string `dynamodbav:"failureReason,omitempty"`
	Caption     string `dynamodbav:"caption,omitempty"`
	// ProcessingSince is set whenever the Photo moves to processing (timeLayout, UTC).
	ProcessingSince string `dynamodbav:"processingSince,omitempty"`
}

const photoPrefix = "PHOTO#"

func photoKey(tripID, id string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: "TRIP#" + tripID},
		"sk": &types.AttributeValueMemberS{Value: photoPrefix + id},
	}
}

func photoFromItem(it photoItem) Photo {
	return Photo{
		ID: it.ID, TripID: it.TripID, Status: PhotoStatus(it.Status), Filename: it.Filename,
		ContentType: it.ContentType, Size: it.Size, UploadedBy: it.UploadedBy, CreatedAt: it.CreatedAt,
		TakenAt: it.TakenAt, Width: it.Width, Height: it.Height,
		ThumbKey: it.ThumbKey, LargeKey: it.LargeKey, Reason: it.Reason, Caption: it.Caption,
		ProcessingSince: it.ProcessingSince,
	}
}

// NewPhotoID returns a fresh Photo id. The API generates every id of a batch (and presigns
// every link) before CreatePhotos writes anything.
func NewPhotoID() (string, error) { return newID() }

// CreatePhotos records new awaiting-upload Photos of a Trip in one all-or-nothing write: a
// failure leaves no record behind. A Trip that no longer exists is ErrNotFound. Each Photo must carry its ID (see NewPhotoID). Every
// record expires after AwaitingUploadTTL unless processing starts first.
func (s *Store) CreatePhotos(ctx context.Context, photos []Photo) ([]Photo, error) {
	now := s.now().UTC()
	out := make([]Photo, len(photos))
	writes := make([]types.TransactWriteItem, 0, len(photos))
	for i, p := range photos {
		if p.ID == "" {
			return nil, errors.New("create photos: photo without an id")
		}
		p.Status, p.CreatedAt = PhotoAwaitingUpload, now.Format(timeLayout)
		item, err := attributevalue.MarshalMap(photoItem{
			PK: "TRIP#" + p.TripID, SK: photoPrefix + p.ID, ID: p.ID, TripID: p.TripID,
			Status: string(p.Status), Filename: p.Filename, ContentType: p.ContentType, Size: p.Size,
			UploadedBy: p.UploadedBy, CreatedAt: p.CreatedAt, ExpiresAt: now.Add(AwaitingUploadTTL).Unix(),
		})
		if err != nil {
			return nil, fmt.Errorf("marshal photo: %w", err)
		}
		writes = append(writes, types.TransactWriteItem{Put: &types.Put{
			TableName:           aws.String(s.table),
			Item:                item,
			ConditionExpression: aws.String("attribute_not_exists(pk)"),
		}})
		out[i] = p
	}
	if len(writes) == 0 {
		return out, nil
	}
	// Every Photo must belong to a Trip that still exists when the write lands, so a Trip
	// deleted meanwhile cannot gain orphan Photo records.
	tripIDs := map[string]bool{}
	for _, p := range photos {
		if tripIDs[p.TripID] {
			continue
		}
		tripIDs[p.TripID] = true
		writes = append(writes, types.TransactWriteItem{ConditionCheck: &types.ConditionCheck{
			TableName:           aws.String(s.table),
			Key:                 tripKey(p.TripID),
			ConditionExpression: aws.String("attribute_exists(pk)"),
		}})
	}
	if _, err := s.db.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: writes}); err != nil {
		var cancelled *types.TransactionCanceledException
		if errors.As(err, &cancelled) {
			for i, r := range cancelled.CancellationReasons {
				if i >= len(photos) && r.Code != nil && *r.Code == "ConditionalCheckFailed" {
					return nil, ErrNotFound
				}
			}
		}
		return nil, fmt.Errorf("put photos: %w", err)
	}
	return out, nil
}

// AbandonedAfter is how long an awaiting-upload Photo stays visible: the upload link's
// lifetime (15 minutes) plus 5 minutes of slack. After that the upload is considered
// abandoned and the Photo is left out of Trip responses, so no device keeps polling for it.
const AbandonedAfter = 20 * time.Minute

// ListPhotos returns a Trip's Photos ordered by date taken (upload time while that is
// unknown). Left out, even if DynamoDB has not swept them yet: awaiting-upload Photos past
// their expiry and abandoned ones (older than AbandonedAfter).
func (s *Store) ListPhotos(ctx context.Context, tripID string) ([]Photo, error) {
	return s.listPhotos(ctx, tripID, nil, nil)
}

// ListPhotoSummaries is ListPhotos for the Album: it reads only id, status, takenAt, createdAt,
// thumbKey, largeKey, expiresAt and processingSince (for the staleness rule), enough to count
// ready Photos and pick thumbnails and the Cover photo. The other fields are empty.
func (s *Store) ListPhotoSummaries(ctx context.Context, tripID string) ([]Photo, error) {
	return s.listPhotos(ctx, tripID,
		aws.String("id, #s, takenAt, createdAt, thumbKey, largeKey, expiresAt, processingSince"),
		map[string]string{"#s": "status"})
}

func (s *Store) listPhotos(ctx context.Context, tripID string, projection *string, names map[string]string) ([]Photo, error) {
	photos := []Photo{}
	now := s.now().UTC()
	abandonedBefore := now.Add(-AbandonedAfter).Format(timeLayout)
	p := dynamodb.NewQueryPaginator(s.db, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :photo)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":    &types.AttributeValueMemberS{Value: "TRIP#" + tripID},
			":photo": &types.AttributeValueMemberS{Value: photoPrefix},
		},
		ProjectionExpression:     projection,
		ExpressionAttributeNames: names,
		ConsistentRead:           aws.Bool(true),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list photos: %w", err)
		}
		var items []photoItem
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, fmt.Errorf("unmarshal photos: %w", err)
		}
		for _, it := range items {
			if it.ExpiresAt != 0 && it.ExpiresAt <= now.Unix() {
				continue
			}
			if PhotoStatus(it.Status) == PhotoAwaitingUpload && it.CreatedAt <= abandonedBefore {
				continue
			}
			photos = append(photos, s.readAs(photoFromItem(it)))
		}
	}
	sort.SliceStable(photos, func(i, j int) bool {
		a, b := photos[i], photos[j]
		if a.SortTime() != b.SortTime() {
			return a.SortTime() < b.SortTime()
		}
		return a.ID < b.ID
	})
	return photos, nil
}

// The Mark* writes are the contract the Python processing steps mirror. Each is
// conditional so a Photo never moves backwards: a duplicate or late update (the workflow
// ran twice, a Catch fired after success) fails its condition and is a quiet no-op, not an
// error. The same applies when the Photo is gone (expired or its Trip deleted).
//
//	MarkPhotoProcessing: from awaiting-upload, processing
//	                     update  SET #s = :processing, processingSince = :now (timeLayout) REMOVE expiresAt, failureReason
//	MarkPhotoReady:      from processing
//	                     update  SET #s = :ready, takenAt, width, height, thumbKey, largeKey REMOVE expiresAt, failureReason
//	MarkPhotoFailed:     from awaiting-upload, processing
//	                     update  SET #s = :failed, failureReason = :r REMOVE expiresAt
//	RetryPhoto:          from failed, or processing with processingSince < now - 15 min
//	                     update  SET #s = :processing, processingSince = :now REMOVE expiresAt, failureReason
//
// (#s is the attribute "status", a reserved word.)

// MarkPhotoProcessing records that the original has arrived: status processing, expiry removed.
// Only an awaiting-upload or processing Photo changes.
func (s *Store) MarkPhotoProcessing(ctx context.Context, tripID, id string) error {
	_, err := s.updatePhoto(ctx, tripID, id, []PhotoStatus{PhotoAwaitingUpload, PhotoProcessing},
		"SET #s = :s, processingSince = :since REMOVE expiresAt, failureReason",
		map[string]types.AttributeValue{":s": str(string(PhotoProcessing)), ":since": str(s.now().UTC().Format(timeLayout))})
	return err
}

// MarkPhotoReady records the web versions: status ready with the version keys, date taken and
// dimensions. Only a processing Photo changes.
func (s *Store) MarkPhotoReady(ctx context.Context, tripID, id string, r Ready) error {
	_, err := s.updatePhoto(ctx, tripID, id, []PhotoStatus{PhotoProcessing},
		"SET #s = :s, takenAt = :taken, width = :w, height = :h, thumbKey = :thumb, largeKey = :large REMOVE expiresAt, failureReason",
		map[string]types.AttributeValue{
			":s": str(string(PhotoReady)), ":taken": str(r.TakenAt),
			":w": num(r.Width), ":h": num(r.Height), ":thumb": str(r.ThumbKey), ":large": str(r.LargeKey),
		})
	return err
}

// MarkPhotoFailed records that processing gave up. Only an awaiting-upload or processing Photo
// changes (awaiting-upload so a Catch on the very first workflow step can still fail a Photo);
// never a ready or failed one.
func (s *Store) MarkPhotoFailed(ctx context.Context, tripID, id, reason string) error {
	_, err := s.updatePhoto(ctx, tripID, id, []PhotoStatus{PhotoAwaitingUpload, PhotoProcessing},
		"SET #s = :s, failureReason = :r REMOVE expiresAt",
		map[string]types.AttributeValue{":s": str(string(PhotoFailed)), ":r": str(reason)})
	return err
}

// RetryPhoto puts a failed Photo back to processing, and reports whether it did: false when
// the Photo is gone or can not be retried (so two retries at once start one workflow). A Photo
// can be retried when it is failed, or processing since more than ProcessingTimeout ago (it
// reads as failed). It is the only write that leaves failed.
func (s *Store) RetryPhoto(ctx context.Context, tripID, id string) (bool, error) {
	now := s.now().UTC()
	_, err := s.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                aws.String(s.table),
		Key:                      photoKey(tripID, id),
		UpdateExpression:         aws.String("SET #s = :processing, processingSince = :now REMOVE expiresAt, failureReason"),
		ConditionExpression:      aws.String("#s = :failed OR (#s = :processing AND processingSince < :cutoff)"),
		ExpressionAttributeNames: map[string]string{"#s": "status"},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":processing": str(string(PhotoProcessing)), ":failed": str(string(PhotoFailed)),
			":now": str(now.Format(timeLayout)), ":cutoff": str(now.Add(-ProcessingTimeout).Format(timeLayout)),
		},
	})
	var failed *types.ConditionalCheckFailedException
	if errors.As(err, &failed) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("retry photo: %w", err)
	}
	return true, nil
}

// GetPhoto returns one Photo of a Trip in any state (with the staleness rule applied), or
// ErrNotFound (also for an expired awaiting-upload one, which listings hide and TTL sweeps).
func (s *Store) GetPhoto(ctx context.Context, tripID, id string) (Photo, error) {
	out, err := s.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.table), Key: photoKey(tripID, id), ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return Photo{}, fmt.Errorf("get photo: %w", err)
	}
	if out.Item == nil {
		return Photo{}, ErrNotFound
	}
	var it photoItem
	if err := attributevalue.UnmarshalMap(out.Item, &it); err != nil {
		return Photo{}, fmt.Errorf("unmarshal photo: %w", err)
	}
	if it.ExpiresAt != 0 && it.ExpiresAt <= s.now().Unix() {
		return Photo{}, ErrNotFound
	}
	return s.readAs(photoFromItem(it)), nil
}

// updatePhoto applies expr when the Photo's status is one of allowed, and reports whether it
// did. A failed condition (wrong status, or the Photo is gone) is (false, nil).
func (s *Store) updatePhoto(ctx context.Context, tripID, id string, allowed []PhotoStatus, expr string, vals map[string]types.AttributeValue) (bool, error) {
	names := make([]string, len(allowed))
	for i, st := range allowed {
		names[i] = fmt.Sprintf(":from%d", i)
		vals[names[i]] = str(string(st))
	}
	_, err := s.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.table),
		Key:                       photoKey(tripID, id),
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("#s IN (" + strings.Join(names, ", ") + ")"),
		ExpressionAttributeNames:  map[string]string{"#s": "status"},
		ExpressionAttributeValues: vals,
	})
	var failed *types.ConditionalCheckFailedException
	if errors.As(err, &failed) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("update photo: %w", err)
	}
	return true, nil
}

func str(v string) types.AttributeValue { return &types.AttributeValueMemberS{Value: v} }

func num(v int) types.AttributeValue {
	n, _ := attributevalue.Marshal(v)
	return n
}

// SetCaption sets a Photo's caption (empty clears it) and returns the Photo, or ErrNotFound.
// It works in any state; it never changes anything else on the Photo.
func (s *Store) SetCaption(ctx context.Context, tripID, id, caption string) (Photo, error) {
	expr, vals := "REMOVE caption", map[string]types.AttributeValue(nil)
	if caption != "" {
		expr, vals = "SET caption = :c", map[string]types.AttributeValue{":c": str(caption)}
	}
	out, err := s.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.table),
		Key:                       photoKey(tripID, id),
		UpdateExpression:          aws.String(expr),
		ConditionExpression:       aws.String("attribute_exists(pk)"),
		ExpressionAttributeValues: vals,
		ReturnValues:              types.ReturnValueAllNew,
	})
	var cond *types.ConditionalCheckFailedException
	if errors.As(err, &cond) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, fmt.Errorf("set caption: %w", err)
	}
	var it photoItem
	if err := attributevalue.UnmarshalMap(out.Attributes, &it); err != nil {
		return Photo{}, fmt.Errorf("unmarshal photo: %w", err)
	}
	return s.readAs(photoFromItem(it)), nil
}

// DeletePhoto removes a Photo record in any state, or returns ErrNotFound. After this the
// Mark* writes no longer apply to it (their conditions need the item), so a workflow that
// is still running cannot bring it back.
func (s *Store) DeletePhoto(ctx context.Context, tripID, id string) error {
	_, err := s.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.table), Key: photoKey(tripID, id),
		ConditionExpression: aws.String("attribute_exists(pk)"),
	})
	var cond *types.ConditionalCheckFailedException
	if errors.As(err, &cond) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("delete photo: %w", err)
	}
	return nil
}

// ListPhotoIDs returns the ids of every Photo record of a Trip, whatever its state, including
// expired and abandoned ones that listings hide.
func (s *Store) ListPhotoIDs(ctx context.Context, tripID string) ([]string, error) {
	var ids []string
	p := dynamodb.NewQueryPaginator(s.db, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :photo)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": str("TRIP#" + tripID), ":photo": str(photoPrefix),
		},
		ProjectionExpression: aws.String("id"),
		ConsistentRead:       aws.Bool(true),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list photo ids: %w", err)
		}
		var items []photoItem
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, fmt.Errorf("unmarshal photo ids: %w", err)
		}
		for _, it := range items {
			ids = append(ids, it.ID)
		}
	}
	return ids, nil
}

const (
	batchWriteMax   = 25 // DynamoDB's limit per BatchWriteItem
	batchWriteLanes = 8  // batches in flight at once
	batchWriteTries = 6  // rounds to drain UnprocessedItems
)

// DeletePhotos removes the given Photo records of a Trip in batches of 25, several batches at
// once, retrying whatever DynamoDB leaves unprocessed. 200 Photos are 8 batches. Missing
// records are fine.
func (s *Store) DeletePhotos(ctx context.Context, tripID string, ids []string) error {
	var batches [][]types.WriteRequest
	for start := 0; start < len(ids); start += batchWriteMax {
		end := min(start+batchWriteMax, len(ids))
		reqs := make([]types.WriteRequest, 0, end-start)
		for _, id := range ids[start:end] {
			reqs = append(reqs, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: photoKey(tripID, id)}})
		}
		batches = append(batches, reqs)
	}
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(batchWriteLanes)
	for _, b := range batches {
		g.Go(func() error { return s.writeBatch(gctx, b) })
	}
	return g.Wait()
}

func (s *Store) writeBatch(ctx context.Context, reqs []types.WriteRequest) error {
	for try := 0; len(reqs) > 0; try++ {
		if try == batchWriteTries {
			return errors.New("delete photos: DynamoDB kept leaving items unprocessed")
		}
		if try > 0 {
			select {
			case <-time.After(time.Duration(try*try) * 25 * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		out, err := s.db.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{s.table: reqs},
		})
		if err != nil {
			return fmt.Errorf("delete photos: %w", err)
		}
		reqs = out.UnprocessedItems[s.table]
	}
	return nil
}
