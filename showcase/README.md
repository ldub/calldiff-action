# Risk-aware checkout showcase

This example evolves a direct checkout pipeline into a safer orchestration flow. The implementation now:

- validates item availability and purchase limits;
- evaluates customer and transaction risk before reserving stock;
- records the inventory reservation;
- separates payment authorization from capture; and
- publishes an order event for customer and warehouse notifications.

The code stays intentionally small so the pull request’s calldiff comment is easy to scan on desktop and mobile.
