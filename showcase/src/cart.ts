export function validateCart() {
  checkItemAvailability()
  validatePurchaseLimits()
}

export function calculateSubtotal() {
  return sumLineItems()
}

function checkItemAvailability() {}
function validatePurchaseLimits() {}
function sumLineItems() {
  return 42
}
