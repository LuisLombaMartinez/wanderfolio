package store_test

import (
	"context"
	"testing"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/testenv"
)

// The setup wizard re-runs seed-member for the same Cognito sub; it must leave exactly one record.
func TestPutMemberIsIdempotent(t *testing.T) {
	st := testenv.NewStore(t)
	ctx := context.Background()

	for _, name := range []string{"Leo", "Leo", "Leo L."} {
		if err := st.PutMember(ctx, store.Member{ID: "sub-1", DisplayName: name}); err != nil {
			t.Fatalf("put member %q: %v", name, err)
		}
	}
	got, err := st.GetMember(ctx, "sub-1")
	if err != nil {
		t.Fatalf("get member: %v", err)
	}
	if got.DisplayName != "Leo L." {
		t.Fatalf("display name = %q, want the last write", got.DisplayName)
	}
}
