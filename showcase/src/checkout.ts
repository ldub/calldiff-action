import { calculateSubtotal, validateCart } from './cart'
import { reserveInventory } from './inventory'
import { publishOrderPlaced } from './events'
import { authorizePayment, capturePayment } from './payment'
import { assessCheckoutRisk } from './risk'

export function checkout() {
  validateCart()
  const total = calculateSubtotal()
  assessCheckoutRisk()
  reserveInventory()
  authorizePayment(total)
  capturePayment(total)
  publishOrderPlaced()
}
