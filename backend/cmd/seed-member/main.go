// Command seed-member writes a Member record (id = Cognito sub, display name).
// It is used by the local-stack script and the setup wizard, so the item layout
// lives only in package store.
//
//	go run ./cmd/seed-member -table <name> -id <sub> -name <display name>
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/LuisLombaMartinez/wanderfolio/backend/internal/store"
)

func main() {
	table := flag.String("table", "", "DynamoDB table name")
	id := flag.String("id", "", "Member id (the Cognito user's sub)")
	name := flag.String("name", "", "Member display name")
	flag.Parse()
	if *table == "" || *id == "" || *name == "" {
		flag.Usage()
		os.Exit(2)
	}
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "load aws config:", err)
		os.Exit(1)
	}
	st := store.New(dynamodb.NewFromConfig(cfg), *table)
	if err := st.PutMember(ctx, store.Member{ID: *id, DisplayName: *name}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Member %s (%s) saved\n", *name, *id)
}
