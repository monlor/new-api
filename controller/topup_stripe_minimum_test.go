package controller

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStripeMinimumTopupUsesQuotaDisplayUnits(t *testing.T) {
	originalMinTopup := setting.StripeMinTopUp
	originalQuotaPerUnit := common.QuotaPerUnit
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	t.Cleanup(func() {
		setting.StripeMinTopUp = originalMinTopup
		common.QuotaPerUnit = originalQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
	})

	setting.StripeMinTopUp = 3
	common.QuotaPerUnit = 500_000

	tests := []struct {
		name             string
		quotaDisplayType string
		minimum          int64
		maximum          int64
	}{
		{
			name:             "currency display keeps configured amount",
			quotaDisplayType: operation_setting.QuotaDisplayTypeUSD,
			minimum:          3,
			maximum:          10_000,
		},
		{
			name:             "token display converts configured amount",
			quotaDisplayType: operation_setting.QuotaDisplayTypeTokens,
			minimum:          1_500_000,
			maximum:          5_000_000_000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tt.quotaDisplayType
			require.Equal(t, tt.minimum, getStripeMinTopup())
			require.Equal(t, tt.maximum, getStripeMaxTopup())
			require.NoError(t, validateStripeTopupAmount(tt.minimum))
			require.Equal(t, int64(3), normalizeStripeTopupAmount(tt.minimum))
			if tt.quotaDisplayType == operation_setting.QuotaDisplayTypeTokens {
				require.Equal(t, int64(4), normalizeStripeTopupAmount(tt.minimum+1))
			}
		})
	}
}

func TestStripeRequestsRejectBelowConfiguredMinimum(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalMinTopup := setting.StripeMinTopUp
	originalQuotaPerUnit := common.QuotaPerUnit
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	t.Cleanup(func() {
		setting.StripeMinTopUp = originalMinTopup
		common.QuotaPerUnit = originalQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
	})

	setting.StripeMinTopUp = 3
	common.QuotaPerUnit = 100

	tests := []struct {
		name             string
		quotaDisplayType string
		amount           int64
		minimum          int64
	}{
		{
			name:             "currency display",
			quotaDisplayType: operation_setting.QuotaDisplayTypeUSD,
			amount:           2,
			minimum:          3,
		},
		{
			name:             "token display",
			quotaDisplayType: operation_setting.QuotaDisplayTypeTokens,
			amount:           299,
			minimum:          300,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tt.quotaDisplayType

			for _, endpoint := range []struct {
				name            string
				handler         gin.HandlerFunc
				expectedMessage string
				expectedData    any
			}{
				{
					name:            "amount preview keeps error details in data",
					handler:         RequestStripeAmount,
					expectedMessage: "error",
					expectedData:    "充值数量不能小于 " + strconv.FormatInt(tt.minimum, 10),
				},
				{
					name:            "payment request keeps error details in message",
					handler:         RequestStripePay,
					expectedMessage: "充值数量不能小于 " + strconv.FormatInt(tt.minimum, 10),
					expectedData:    float64(10),
				},
			} {
				t.Run(endpoint.name, func(t *testing.T) {
					recorder := httptest.NewRecorder()
					ctx, _ := gin.CreateTestContext(recorder)
					ctx.Request = httptest.NewRequest(
						http.MethodPost,
						"/api/user/stripe",
						strings.NewReader(`{"amount":`+strconv.FormatInt(tt.amount, 10)+`,"payment_method":"stripe"}`),
					)
					ctx.Request.Header.Set("Content-Type", "application/json")

					endpoint.handler(ctx)

					var response struct {
						Message string `json:"message"`
						Data    any    `json:"data"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
					require.Equal(t, endpoint.expectedMessage, response.Message)
					require.Equal(t, endpoint.expectedData, response.Data)
				})
			}
		})
	}
}

func TestStripeRequestsRejectAboveConfiguredMaximum(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalQuotaPerUnit := common.QuotaPerUnit
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
	})

	common.QuotaPerUnit = 100

	for _, quotaDisplayType := range []string{
		operation_setting.QuotaDisplayTypeUSD,
		operation_setting.QuotaDisplayTypeTokens,
	} {
		t.Run(quotaDisplayType, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = quotaDisplayType
			amount := getStripeMaxTopup() + 1

			for _, endpoint := range []struct {
				name            string
				handler         gin.HandlerFunc
				expectedMessage string
				expectedData    any
			}{
				{
					name:            "amount preview keeps error details in data",
					handler:         RequestStripeAmount,
					expectedMessage: "error",
					expectedData:    "充值数量不能大于 " + strconv.FormatInt(getStripeMaxTopup(), 10),
				},
				{
					name:            "payment request keeps error details in message",
					handler:         RequestStripePay,
					expectedMessage: "充值数量不能大于 " + strconv.FormatInt(getStripeMaxTopup(), 10),
					expectedData:    float64(10),
				},
			} {
				t.Run(endpoint.name, func(t *testing.T) {
					recorder := httptest.NewRecorder()
					ctx, _ := gin.CreateTestContext(recorder)
					ctx.Request = httptest.NewRequest(
						http.MethodPost,
						"/api/user/stripe",
						strings.NewReader(`{"amount":`+strconv.FormatInt(amount, 10)+`,"payment_method":"stripe"}`),
					)
					ctx.Request.Header.Set("Content-Type", "application/json")

					endpoint.handler(ctx)

					var response struct {
						Message string `json:"message"`
						Data    any    `json:"data"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
					require.Equal(t, endpoint.expectedMessage, response.Message)
					require.Equal(t, endpoint.expectedData, response.Data)
				})
			}
		})
	}
}

func TestTopupInfoExposesConvertedStripeMinimum(t *testing.T) {
	gin.SetMode(gin.TestMode)
	confirmPaymentComplianceForTest(t)
	originalMinTopup := setting.StripeMinTopUp
	originalQuotaPerUnit := common.QuotaPerUnit
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret
	originalPriceID := setting.StripePriceId
	originalPayMethods := operation_setting.PayMethods
	t.Cleanup(func() {
		setting.StripeMinTopUp = originalMinTopup
		common.QuotaPerUnit = originalQuotaPerUnit
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
		setting.StripeApiSecret = originalAPISecret
		setting.StripeWebhookSecret = originalWebhookSecret
		setting.StripePriceId = originalPriceID
		operation_setting.PayMethods = originalPayMethods
	})

	setting.StripeMinTopUp = 3
	common.QuotaPerUnit = 100
	setting.StripeApiSecret = "sk_test_123"
	setting.StripeWebhookSecret = "whsec_test"
	setting.StripePriceId = "price_123"
	originalCustomStripeMinimum := "999"
	operation_setting.PayMethods = []map[string]string{
		{"type": model.PaymentMethodStripe, "name": "Custom Stripe", "min_topup": originalCustomStripeMinimum},
		{"type": "custom1", "min_topup": "20"},
	}

	tests := []struct {
		name             string
		quotaDisplayType string
		expected         int64
	}{
		{
			name:             "currency display",
			quotaDisplayType: operation_setting.QuotaDisplayTypeUSD,
			expected:         3,
		},
		{
			name:             "token display",
			quotaDisplayType: operation_setting.QuotaDisplayTypeTokens,
			expected:         300,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tt.quotaDisplayType
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/info", nil)

			GetTopUpInfo(ctx)

			var response struct {
				Data struct {
					StripeMinTopup int64               `json:"stripe_min_topup"`
					PayMethods     []map[string]string `json:"pay_methods"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.Equal(t, tt.expected, response.Data.StripeMinTopup)
			require.Equal(t, strconv.FormatInt(tt.expected, 10), stripeMinimumFromPayMethods(t, response.Data.PayMethods))
			require.Equal(t, originalCustomStripeMinimum, operation_setting.PayMethods[0]["min_topup"])
		})
	}
}

func stripeMinimumFromPayMethods(t *testing.T, payMethods []map[string]string) string {
	t.Helper()
	for _, method := range payMethods {
		if method["type"] == model.PaymentMethodStripe {
			return method["min_topup"]
		}
	}
	t.Fatal("Stripe payment method not found")
	return ""
}
