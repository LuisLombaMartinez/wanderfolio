package store

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// A cancelled accept is only "already accepted" or "Trip gone" when the reasons say so;
// a conflict or throttling must surface as a failure, never as a Pending success.
func TestAcceptCancellation(t *testing.T) {
	r := func(code string) types.CancellationReason { return types.CancellationReason{Code: aws.String(code)} }
	for _, tc := range []struct {
		name    string
		reasons []types.CancellationReason
		want    acceptOutcome
	}{
		{"invitation condition failed", []types.CancellationReason{r("ConditionalCheckFailed"), r("None")}, acceptAlreadyDone},
		{"trip condition failed", []types.CancellationReason{r("None"), r("ConditionalCheckFailed")}, acceptTripGone},
		{"conflict", []types.CancellationReason{r("TransactionConflict"), r("None")}, acceptFailed},
		{"throttled", []types.CancellationReason{r("None"), r("ThrottlingError")}, acceptFailed},
		{"no reasons", nil, acceptFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := acceptCancellation(tc.reasons); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}
