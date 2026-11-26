// Package processing starts the photo-processing Step Functions workflow.
package processing

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/service/sfn"
)

// Starter starts the processing state machine, the way the EventBridge rule does for a new
// original: the input is {"bucket": <photo bucket>, "key": <original key>}.
type Starter struct {
	client  *sfn.Client
	machine string
	bucket  string
}

// NewStarter returns a Starter for the state machine ARN and the photo bucket.
func NewStarter(client *sfn.Client, machineARN, bucket string) *Starter {
	return &Starter{client: client, machine: machineARN, bucket: bucket}
}

// StartProcessing starts one asynchronous execution (the machine is an Express workflow).
func (s *Starter) StartProcessing(ctx context.Context, key string) error {
	input, err := json.Marshal(map[string]string{"bucket": s.bucket, "key": key})
	if err != nil {
		return err
	}
	in := string(input)
	if _, err := s.client.StartExecution(ctx, &sfn.StartExecutionInput{StateMachineArn: &s.machine, Input: &in}); err != nil {
		return fmt.Errorf("start processing: %w", err)
	}
	return nil
}
