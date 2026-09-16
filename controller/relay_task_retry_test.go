package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestShouldRetryTaskRelaySkipsLocalChannelRateLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	retry := shouldRetryTaskRelay(c, 1, &dto.TaskError{
		StatusCode: http.StatusTooManyRequests,
		LocalError: true,
		Message:    "channel rate limited",
	}, 3)
	require.False(t, retry)
}

func TestShouldRetryTaskRelayRetriesUpstream429(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	retry := shouldRetryTaskRelay(c, 1, &dto.TaskError{
		StatusCode: http.StatusTooManyRequests,
		LocalError: false,
		Message:    "upstream saturated",
	}, 3)
	require.True(t, retry)
}

func TestRespondTaskErrorKeepsLocalChannelRateLimitMessage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	msg := "Channel rate limit reached: maximum 2 requests per 1000ms, please retry later"
	respondTaskError(c, &dto.TaskError{
		Code:       "rate_limit:channel",
		Message:    msg,
		StatusCode: http.StatusTooManyRequests,
		LocalError: true,
	})
	require.Contains(t, w.Body.String(), "maximum 2 requests")
	require.NotContains(t, w.Body.String(), "当前分组上游负载已饱和")
}
