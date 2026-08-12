package controller

import (
	"testing"

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
