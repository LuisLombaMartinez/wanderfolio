// Package claims carries the JWT claims API Gateway's authorizer has already
// verified from the Lambda adapter to the API handlers. Nothing here validates tokens.
package claims

import "context"

type key struct{}

// With returns a context carrying the forwarded claims.
func With(ctx context.Context, c map[string]string) context.Context {
	return context.WithValue(ctx, key{}, c)
}

// From returns the forwarded claims, or nil if there are none.
func From(ctx context.Context) map[string]string {
	c, _ := ctx.Value(key{}).(map[string]string)
	return c
}

// Subject returns the Cognito `sub` claim (the Member id), or "".
func Subject(ctx context.Context) string {
	return From(ctx)["sub"]
}
