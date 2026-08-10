export function authorizePayment(total: number) {
  tokenizeCard()
  runFraudScreen()
  createAuthorization(total)
}

export function capturePayment(_total: number) {}

function tokenizeCard() {}
function runFraudScreen() {}
function createAuthorization(_total: number) {}
