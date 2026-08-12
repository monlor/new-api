package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/form"
)

func TestBuildStripeSubscriptionCheckoutParamsCustomerFields(t *testing.T) {
	tests := []struct {
		name                  string
		customerID            string
		email                 string
		expectedCustomer      string
		expectedCustomerEmail string
	}{
		{
			name:                  "new customer with email",
			email:                 "new@example.com",
			expectedCustomerEmail: "new@example.com",
		},
		{
			name: "new customer without email",
		},
		{
			name:             "existing customer",
			customerID:       "cus_123",
			email:            "ignored@example.com",
			expectedCustomer: "cus_123",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			params := buildStripeSubscriptionCheckoutParams(
				"sub_ref_123",
				42,
				7,
				test.customerID,
				test.email,
				"price_123",
				"https://example.com/return",
			)
			body := &form.Values{}
			form.AppendTo(body, params)

			require.Equal(t, stripe.CheckoutSessionModeSubscription, stripe.CheckoutSessionMode(*params.Mode))
			require.Nil(t, params.CustomerCreation)
			require.Empty(t, body.Get("customer_creation"))
			require.Equal(t, []string{"sub_ref_123"}, body.Get("metadata[trade_no]"))
			require.Equal(t, []string{"42"}, body.Get("subscription_data[metadata][user_id]"))
			require.Equal(t, []string{"7"}, body.Get("subscription_data[metadata][plan_id]"))

			if test.expectedCustomer == "" {
				require.Nil(t, params.Customer)
				require.Empty(t, body.Get("customer"))
			} else {
				require.Equal(t, test.expectedCustomer, *params.Customer)
				require.Equal(t, []string{test.expectedCustomer}, body.Get("customer"))
			}

			if test.expectedCustomerEmail == "" {
				require.Nil(t, params.CustomerEmail)
				require.Empty(t, body.Get("customer_email"))
			} else {
				require.Equal(t, test.expectedCustomerEmail, *params.CustomerEmail)
				require.Equal(t, []string{test.expectedCustomerEmail}, body.Get("customer_email"))
			}
		})
	}
}

func TestStripeInvoiceSubscriptionPriceIdFromBasilInvoiceLines(t *testing.T) {
	tests := []struct {
		name        string
		invoiceJSON string
		expected    string
		errorText   string
	}{
		{
			name: "unique subscription price",
			invoiceJSON: `{"lines":{"data":[
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_123"}},"pricing":{"type":"price_details","price_details":{"price":"price_recurring","product":"prod_123"}}},
				{"parent":{"type":"invoice_item_details","invoice_item_details":{"invoice_item":"ii_123"}},"pricing":{"type":"price_details","price_details":{"price":"price_one_time","product":"prod_extra"}}}
			]}}`,
			expected: "price_recurring",
		},
		{
			name: "multiple subscription lines with the same price",
			invoiceJSON: `{"lines":{"data":[
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_123"}},"pricing":{"type":"price_details","price_details":{"price":"price_recurring","product":"prod_123"}}},
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_456"}},"pricing":{"type":"price_details","price_details":{"price":"price_recurring","product":"prod_123"}}}
			]}}`,
			expected: "price_recurring",
		},
		{
			name: "no subscription line",
			invoiceJSON: `{"lines":{"data":[
				{"parent":{"type":"invoice_item_details","invoice_item_details":{"invoice_item":"ii_123"}},"pricing":{"type":"price_details","price_details":{"price":"price_one_time","product":"prod_extra"}}}
			]}}`,
			errorText: "missing subscription price",
		},
		{
			name: "subscription line missing price",
			invoiceJSON: `{"lines":{"data":[
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_123"}},"pricing":{"type":"price_details","price_details":{"product":"prod_123"}}}
			]}}`,
			errorText: "subscription line is missing price",
		},
		{
			name: "multiple subscription prices",
			invoiceJSON: `{"lines":{"data":[
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_123"}},"pricing":{"type":"price_details","price_details":{"price":"price_high","product":"prod_123"}}},
				{"parent":{"type":"subscription_item_details","subscription_item_details":{"subscription":"sub_123","subscription_item":"si_456"}},"pricing":{"type":"price_details","price_details":{"price":"price_low","product":"prod_456"}}}
			]}}`,
			errorText: "multiple subscription prices",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var invoice stripe.Invoice
			require.NoError(t, common.Unmarshal([]byte(test.invoiceJSON), &invoice))
			priceId, err := stripeInvoiceSubscriptionPriceId(&invoice)
			if test.errorText != "" {
				require.ErrorContains(t, err, test.errorText)
				require.Empty(t, priceId)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.expected, priceId)
		})
	}
}
