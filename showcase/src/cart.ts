export function validateCart() {
  checkItemAvailability()
  validateCoupon()
}

export function calculateSubtotal() {
  return sumLineItems()
}

function checkItemAvailability() {}
function validateCoupon() {}
function sumLineItems() {
  return 42
}
