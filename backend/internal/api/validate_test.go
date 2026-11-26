package api

import (
	"strings"
	"testing"
)

func TestValidateTrip(t *testing.T) {
	ok := tripInput{Title: "T", Destination: "D", StartDate: "2026-01-01", EndDate: "2026-01-02"}
	with := func(f func(*tripInput)) tripInput { in := ok; f(&in); return in }

	cases := map[string]struct {
		in   tripInput
		code string
	}{
		"valid":                   {ok, ""},
		"same day":                {with(func(i *tripInput) { i.EndDate = i.StartDate }), ""},
		"120 multibyte title":     {with(func(i *tripInput) { i.Title = strings.Repeat("ñ", 120) }), ""},
		"121 multibyte title":     {with(func(i *tripInput) { i.Title = strings.Repeat("ñ", 121) }), "title-too-long"},
		"destination too long":    {with(func(i *tripInput) { i.Destination = strings.Repeat("a", 121) }), "destination-too-long"},
		"description too long":    {with(func(i *tripInput) { i.Description = strings.Repeat("a", 2001) }), "description-too-long"},
		"description newlines ok": {with(func(i *tripInput) { i.Description = "a\r\nb\tc" }), ""},
		"control in title":        {with(func(i *tripInput) { i.Title = "a\x00b" }), "invalid-characters"},
		"newline in title":        {with(func(i *tripInput) { i.Title = "a\nb" }), "invalid-characters"},
		"tab in destination":      {with(func(i *tripInput) { i.Destination = "a\tb" }), "invalid-characters"},
		"escape in description":   {with(func(i *tripInput) { i.Description = "a\x1bb" }), "invalid-characters"},
		"end before start":        {with(func(i *tripInput) { i.EndDate = "2025-12-31" }), "end-before-start"},
		"blank title":             {with(func(i *tripInput) { i.Title = " " }), "title-required"},
		"impossible date":         {with(func(i *tripInput) { i.StartDate = "2026-02-30" }), "invalid-date"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, code, _ := validateTrip(tc.in); code != tc.code {
				t.Errorf("code = %q, want %q", code, tc.code)
			}
		})
	}
}
