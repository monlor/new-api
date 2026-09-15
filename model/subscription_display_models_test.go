package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSplitDisplayModels(t *testing.T) {
	require.Empty(t, SplitDisplayModels(""))
	require.Empty(t, SplitDisplayModels("  "))
	require.Equal(t, []string{"a", "b"}, SplitDisplayModels("a,b"))
	require.Equal(t, []string{"a", "b"}, SplitDisplayModels(" a , b "))
	require.Equal(t, []string{"a", "b"}, SplitDisplayModels("a,,b"))
	require.Equal(t, []string{"a", "b"}, SplitDisplayModels("a, b,"))
}

func TestDisplayModelsWellFormed(t *testing.T) {
	for _, s := range []string{"", "  ", "a", "a,b", " a , b "} {
		require.True(t, DisplayModelsWellFormed(s), s)
	}
	for _, s := range []string{"a,,b", "a, b,", ",a", ",", "a, ,b"} {
		require.False(t, DisplayModelsWellFormed(s), s)
	}
}

func TestGetDisplayModelsUsesSplitter(t *testing.T) {
	plan := &SubscriptionPlan{DisplayModels: " gpt-4 , gpt-4o "}
	require.Equal(t, []string{"gpt-4", "gpt-4o"}, plan.GetDisplayModels())
}
