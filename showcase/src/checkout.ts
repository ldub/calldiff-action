import { calculateSubtotal, validateCart } from './cart'
import { reserveInventory } from './inventory'
import { sendConfirmation } from './notifications'
import { chargeCard } from './payment'

export function checkout() {
  validateCart()
  const total = calculateSubtotal()
  reserveInventory()
  chargeCard(total)
  sendConfirmation()
}
