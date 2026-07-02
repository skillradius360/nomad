# eLabAssist Frontend Project Context

Use this as the main build context for a React/Vite frontend. It is based on the live Express backend mounted in `src/app.js`, the current route files in `src/routes`, and the Prisma domain in `prisma/schema.prisma`.

## 1. Project Shape

This backend powers a role-based local marketplace/admin system.

The product has three main apps:

- Buyer app: location-based shop discovery, shop browsing, menus, cart, offers, checkout, order tracking, ads, banners.
- Seller app: seller onboarding, shop setup, availability/timings, catalog, variants, combos, menus, offers, banners, order workflow, revenue, billing/recharge.
- Admin app: user/shop oversight, catalog setup, shop types/features, ads, buyer ads, orders, analytics, billing, revenue.

Base local API:

```txt
http://localhost:8000
```

Most routes require JWT:

```txt
Authorization: Bearer <accessToken>
```

Normal requests use JSON. Image upload routes use `FormData`; do not manually set `Content-Type` for `FormData`.

Success responses usually follow:

```ts
type ApiResponse<T> = {
  statusCode: number;
  data: T;
  message: string;
  success: true;
};
```

Error responses usually follow:

```ts
type ApiErrorResponse = {
  success: false;
  message: string;
  stack?: string;
};
```

Show `message` from the backend for failed API calls.

## 2. Core Rules

- `itemId` means master catalog item.
- `shopItemId` means seller/shop-owned item.
- Cart, checkout, menus, combos, item offers, and item order lines must use `shopItemId`.
- Admin/master catalog screens use `itemId`.
- Seller creates sellable inventory with `POST /items/custom`, not `POST /items/create`.
- `POST /items/create` creates a master catalog item only.
- Variants belong to `ShopItem`, not master `Items`.
- Measured items cannot have variants and cannot be used in combos.
- Running menus can be read using backend current time, or overridden by query params.
- Shop type features determine whether a shop supports items, categories, cuisine, menus, and combos.
- Buyer nearby shop flow requires buyer latitude/longitude.
- Order lifecycle is `NEW -> PREPARING -> READY -> DONE`; `CANCELLED` is separate.
- Seller wallet/billing is manual recharge request plus admin approval; no payment gateway is integrated in the backend.

## 3. Enums

```ts
type UserRole = "SUPER" | "BUYER" | "SELLER" | "ADMIN";
type ShopStatus = "OPEN" | "CLOSED" | "AUTOMATIC";
type ShopBillingStatus = "TRIAL" | "ACTIVE" | "PAYMENT_DUE" | "HOLD";
type RechargeStatus = "PENDING" | "APPROVED" | "REJECTED";
type ShopFeatureKey = "ITEMS" | "CATEGORIES" | "CUISINE" | "MENUS" | "COMBOS";
type AdPlacement = "SELLER_DASHBOARD" | "SELLER_HOME" | "BUYER_EXPLORE" | "BUYER_SHOP_PAGE";
type AdTargetMode = "ALL_SELLERS" | "TARGETED_SELLERS";
type OrderStatus = "NEW" | "PREPARING" | "READY" | "DONE" | "CANCELLED";
type PaymentMethod = "CASH" | "CARD" | "UPI";
type OrderItemType = "ITEM" | "COMBO";
type ShopItemPricingMode = "FIXED" | "MEASURED";
type ShopItemUnit = "KG" | "GRAM" | "LITRE" | "ML" | "PIECE" | "DOZEN" | "PACK" | "BUNCH" | "BOX" | "CUSTOM";
type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
type OfferType = "BUY_X_GET_Y" | "PERCENT_DISCOUNT" | "FLAT_DISCOUNT" | "FREE_DELIVERY" | "COMBO_DISCOUNT";
type OfferMenuScope = "ALL_MENUS" | "SPECIFIC_MENUS";
type OfferApplyTo = "ALL_CART" | "SPECIFIC_ITEMS" | "SPECIFIC_COMBOS" | "ALL_ITEMS_IN_SELECTED_COMBOS";
type OfferAudienceType = "ALL_BUYERS" | "SPECIFIC_BUYERS" | "TAG_BASED" | "PREMIUM_CUSTOMERS" | "NEW_CUSTOMERS";
type OfferStackingMode = "EXCLUSIVE" | "STACKABLE";
type OfferDiscountType = "PERCENTAGE" | "FLAT" | "FREE";
type RevenuePeriodType = "DAILY" | "MONTHLY" | "YEARLY";
```

## 4. Recommended Frontend Modules

```txt
src/api/client.ts
src/api/auth.ts
src/api/users.ts
src/api/buyers.ts
src/api/sellers.ts
src/api/shops.ts
src/api/shopTypes.ts
src/api/catalog.ts
src/api/items.ts
src/api/combos.ts
src/api/menus.ts
src/api/offers.ts
src/api/orders.ts
src/api/ads.ts
src/api/banners.ts
src/api/revenue.ts
src/api/billing.ts
src/api/analytics.ts

src/features/auth
src/features/onboarding
src/features/buyer
src/features/seller
src/features/admin
src/features/catalog
src/features/cart
src/features/orders
src/features/offers
src/features/billing
src/features/analytics
```

Route guard logic:

- No token: login.
- Token exists: call `GET /users/me`.
- Blocked user: account disabled page.
- No completed role profile: show buyer/seller onboarding.
- `BUYER`: buyer app.
- `SELLER`: seller app.
- `ADMIN`: admin app.

## 5. Auth And User Flow

OTP login:

```http
POST /auth/generateOTP
POST /auth/verifyOTP
DELETE /auth/invalidateOTP
GET /auth/google
GET /auth/google/callback
```

After OTP verification, store the JWT and immediately call:

```http
GET /users/me
```

User/admin routes:

```http
GET /users
GET /users/all-data
GET /users/me
PATCH /users/me
PATCH /users/modUser/:userId
DELETE /users/delUser/:userId
PATCH /users/suspend/:userId
GET /users/sellers
GET /users/buyers
GET /users/admin/shops
GET /users/admin/shops/:shopId
GET /users/admin/buyers
GET /users/admin/buyers/:buyerId
PATCH /users/admin/buyers/:buyerId/status
GET /users/admin/sellers
GET /users/admin/sellers/:sellerId
PATCH /users/admin/sellers/:sellerId/status
```

Profile image upload field:

```txt
avatar
```

## 6. Buyer Flow

Buyer screens:

- Login
- Buyer profile/location setup
- Nearby shops
- Shop detail by id or slug
- Running menus
- Cart
- Offers
- Checkout
- My orders
- Order status/timeline/invoice
- Ads and banners

Buyer profile:

```http
POST /buyers/create
GET /buyers/me
PATCH /buyers/me
DELETE /buyers/me
PATCH /buyers/:userId
POST /buyers/create/:userId
```

Discovery:

```http
GET /shops/nearby?radius=10&status=ALL&page=1&limit=20
GET /shops
GET /shops/find/:shopId
GET /shops/findshop/:slug
GET /cuisines
GET /cuisines/only
GET /cuisines/shop/:shopId
GET /categories/only
GET /categories/shop/:shopId
GET /categories/cuisine
GET /categories/cuisine/:cuisineName
GET /items/shop/:shopId
GET /combos/shop/:shopId
GET /menus/shop/:shopId/running
GET /offers/shop/:shopId/available
GET /banners/shop/:shopId/published
GET /ads/buyer
GET /ads/buyer-ads
GET /ads/fetchAll
```

Cart item shape:

```ts
type CartState = {
  shopId: string | null;
  items: {
    shopItemId: string;
    name: string;
    basePrice: number;
    quantity: number;
    variantOptionIds?: string[];
    variantSnapshot?: SelectedVariant[];
  }[];
  combos: {
    comboId: string;
    name: string;
    price: number;
    quantity: number;
  }[];
  offerIds: string[];
  deliveryAmount: number;
};
```

Checkout:

```http
POST /orders/checkout
```

```ts
type CheckoutBody = {
  shopId: string;
  paymentMethod: PaymentMethod;
  paymentReceived?: boolean;
  deliveryAmount?: number;
  customerNote?: string;
  offerIds?: string[];
  items?: {
    shopItemId: string;
    quantity: number;
    variantOptionIds?: string[];
  }[];
  combos?: {
    comboId: string;
    quantity: number;
  }[];
};
```

Buyer orders:

```http
GET /orders/my?page=1&limit=20
GET /orders/:orderId
GET /orders/:orderId/status
GET /orders/:orderId/timeline
GET /orders/:orderId/invoice
PATCH /orders/:orderId/cancel
```

## 7. Seller Flow

Seller screens:

- Seller onboarding
- Seller profile
- Shop create/edit
- Shop feature-aware setup
- Timings/status/availability
- Items and variants
- Combos
- Menus
- Offers
- Banners
- Ads
- Active orders
- Processed orders
- Revenue
- Billing summary, ledger, recharge requests

Seller profile:

```http
POST /sellers/create
POST /sellers/create/:userId
GET /sellers/me
PATCH /sellers/edit
PATCH /sellers/:userId
DELETE /sellers/me
```

Shop management:

```http
POST /shops/create
PATCH /shops/:shopId/settings
PATCH /shops/:shopId/timings
PATCH /shops/:shopId/status
PATCH /shops/:shopId/availability
GET /shops/:shopId/customers
```

Shop image upload field:

```txt
shopimg
```

Shop status body:

```json
{
  "status": "AUTOMATIC"
}
```

Availability toggle body:

```json
{
  "shopOpen": true,
  "deliveryEnabled": true
}
```

Timings use `DayOfWeek` and time strings such as `9am`, `9:00am`, `18:00`, or minute-based internal values depending on the endpoint response.

Seller item/inventory flow:

```http
POST /items/custom
GET /items/shop/:shopId?page=1&limit=20
PATCH /items/shop-items/:shopItemId
DELETE /items/shop-items/:shopItemId
PATCH /items/shop-items/reorder
```

Add existing master item to shop:

```json
{
  "shopId": "{{shopId}}",
  "itemId": "{{itemId}}",
  "pricing": 100,
  "availableQuantity": 50,
  "description": "Seller description",
  "active": true
}
```

Add custom seller item:

```json
{
  "shopId": "{{shopId}}",
  "itemName": "Special Tea",
  "categoryName": "Beverages",
  "pricing": 20,
  "availableQuantity": 100,
  "variantGroups": [
    {
      "name": "Cup Size",
      "required": true,
      "minSelect": 1,
      "maxSelect": 1,
      "options": [
        { "label": "Small", "amount": 0 },
        { "label": "Large", "amount": 20 }
      ]
    }
  ]
}
```

Measured item shape:

```json
{
  "shopId": "{{shopId}}",
  "itemName": "Rice",
  "pricingMode": "MEASURED",
  "unit": "KG",
  "displayUnit": "kg",
  "pricePerUnit": 80,
  "minOrderQuantity": 0.5,
  "quantityStep": 0.5,
  "availableQuantityValue": 100
}
```

Combos:

```http
GET /combos/builder
GET /combos/classification
GET /combos/shop/:shopId
POST /combos/create
PATCH /combos/:comboId
DELETE /combos/:comboId
```

Combo item input uses `itemId` as the field name, but the value must be a `shopItemId`.

```json
{
  "shopId": "{{shopId}}",
  "name": "Lunch Combo",
  "totalPrice": 199,
  "availableQuantity": 20,
  "items": [
    { "itemId": "{{shopItemId}}", "quantity": 1 }
  ]
}
```

Menus:

```http
GET /menus/shop/:shopId/running
POST /menus/create
PATCH /menus/reorder
PATCH /menus/:menuId
DELETE /menus/:menuId
```

Preset menu body:

```json
{
  "shopId": "{{shopId}}",
  "name": "Breakfast",
  "scheduleType": "weekdays",
  "timeRange": "8am-11am",
  "items": [
    { "itemId": "{{shopItemId}}" }
  ],
  "combos": [
    { "comboId": "{{comboId}}" }
  ]
}
```

Offers:

```http
POST /offers/create
GET /offers/shop/:shopId
GET /offers/shop/:shopId/available
GET /offers/shop/:shopId/buyers/search
GET /offers/:offerId
GET /offers/:offerId/usage
GET /offers/:offerId/analytics
POST /offers/:offerId/duplicate
PATCH /offers/:offerId
PATCH /offers/:offerId/active
DELETE /offers/:offerId
```

Seller orders:

```http
GET /orders/seller
GET /orders/seller/processed
PATCH /orders/:orderId/payment-received
PATCH /orders/:orderId/confirm
PATCH /orders/:orderId/ready
PATCH /orders/:orderId/complete
PATCH /orders/:orderId/refund
```

Seller revenue:

```http
GET /revenue/shop/:shopId
GET /revenue/shop/:shopId/repeat-customers
GET /billing/shops/:shopId/summary
GET /billing/shops/:shopId/ledger
```

Seller recharge:

```http
GET /billing/config
POST /billing/recharges
GET /billing/recharges/my
```

## 8. Admin Flow

Admin screens:

- Dashboard/analytics
- Users
- Buyers
- Sellers
- Shops
- Shop types/features
- Cuisines
- Categories
- Master items
- Tags
- Seller ads
- Buyer ads
- Orders
- Revenue
- Billing settings, recharge approvals, settlements, company revenue

Analytics:

```http
GET /analytics/admin/summary
GET /analytics/admin/trends
GET /analytics/admin/top-shops
GET /analytics/admin/top-buyers
GET /analytics/admin/seller-wallet-monitor
```

Shop oversight:

```http
GET /shops/admin/all
PATCH /shops/start/:shopId
PATCH /shops/:shopId/trial
DELETE /shops/revoke/:shopId
```

Shop types/features:

```http
GET /shop-types
POST /shop-types
GET /shop-types/:shopTypeId
PATCH /shop-types/:shopTypeId
DELETE /shop-types/:shopTypeId
GET /shop-types/shops/:shopId/features
PATCH /shop-types/shops/:shopId/features
DELETE /shop-types/shops/:shopId/features
```

Master catalog:

```http
POST /cuisines/create
GET /cuisines
GET /cuisines/fetchallcuisines
GET /cuisines/only
PATCH /cuisines/reorder
PATCH /cuisines/:cuisineId
DELETE /cuisines/:cuisineId

POST /categories/create
POST /categories/map
GET /categories/fetchallcategories
GET /categories/only
GET /categories/cuisine
GET /categories/cuisine/:cuisineName
PATCH /categories/reorder
PATCH /categories/:categoryId
DELETE /categories/:categoryId

POST /items/create
POST /items/map
GET /items
GET /items/fetchallitems
GET /items/only
GET /items/category
GET /items/category/:categoryName
PATCH /items/reorder
PATCH /items/:itemId
DELETE /items/:itemId
```

Tags:

```http
GET /tags/allTags
GET /tags/active
POST /tags/create
GET /tags/:tagId
PATCH /tags/:tagId
DELETE /tags/:tagId
PATCH /tags/:tagId/active
POST /tags/items/:itemId
DELETE /tags/items/:itemId/:tagId
POST /tags/combos/:comboId
DELETE /tags/combos/:comboId/:tagId
```

Ads:

```http
POST /ads/create
GET /ads/seller
GET /ads/buyer
GET /ads/fetchAll
PATCH /ads/:adId/active
DELETE /ads/:adId

POST /ads/buyer-ads/admin
GET /ads/buyer-ads/admin
GET /ads/buyer-ads/admin/:buyerAdId
PATCH /ads/buyer-ads/admin/:buyerAdId
DELETE /ads/buyer-ads/admin/:buyerAdId
PATCH /ads/buyer-ads/admin/:buyerAdId/active
```

Seller ad upload fields:

```txt
sellerDashboardImg
sellerHomeImg
buyerExploreImg
buyerShopPageImg
```

Buyer ad upload field:

```txt
buyerAdImg
```

Banners:

```http
POST /banners/create
GET /banners/shop/:shopId/published
GET /banners/shop/:shopId/manage
PATCH /banners/:bannerId
DELETE /banners/:bannerId
PATCH /banners/:bannerId/publish
```

Banner upload fields:

```txt
bannerImg
image
```

Admin orders/revenue:

```http
GET /orders/processed/all
GET /orders/:orderId
GET /orders/:orderId/timeline
GET /orders/:orderId/invoice
GET /revenue/shop/:shopId
GET /revenue/shop/:shopId/repeat-customers
```

Admin billing:

```http
GET /billing/config
PATCH /billing/config
POST /billing/day-options
DELETE /billing/day-options/:optionId
POST /billing/amount-options
DELETE /billing/amount-options/:optionId
GET /billing/recharges
PATCH /billing/recharges/:rechargeId/review
GET /billing/shops/:shopId/summary
GET /billing/shops/:shopId/revenue
GET /billing/shops/:shopId/ledger
POST /billing/shops/:shopId/sync-slots
POST /billing/settlements/run
GET /billing/company-revenue
```

## 9. Order System

Checkout creates an order with status `NEW`.

Seller workflow:

```txt
NEW -> PREPARING -> READY -> DONE
```

Important order actions:

- Buyer can cancel with `PATCH /orders/:orderId/cancel`.
- Seller confirms with `PATCH /orders/:orderId/confirm`.
- Seller marks ready with `PATCH /orders/:orderId/ready`.
- Seller completes with `PATCH /orders/:orderId/complete`.
- Seller/admin can refund completed orders with `PATCH /orders/:orderId/refund`.
- `PATCH /orders/:orderId/payment-received` is for cash/manual payment confirmation.

Order line items can be either item or combo:

```ts
type OrderLineItem = {
  id: string;
  type: "ITEM" | "COMBO";
  itemId: string;
  shopItemId?: string | null;
  comboId?: string | null;
  name: string;
  quantity: number;
  price: number;
  totalPrice: number;
  variants?: SelectedVariant[];
};
```

## 10. Variants And Pricing

Variants are grouped options on `ShopItem`.

```ts
type ShopItemVariantGroup = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  active: boolean;
  options: ShopItemVariantOption[];
};

type ShopItemVariantOption = {
  id: string;
  label: string;
  subLabel?: string | null;
  amount: number;
  sortOrder: number;
  active: boolean;
};

type SelectedVariant = {
  groupId: string;
  groupName: string;
  optionId: string;
  label: string;
  amount: number;
};
```

Frontend rules:

- For required groups, force at least `minSelect`.
- Never allow more than `maxSelect`.
- Add option `amount` to the base fixed price.
- Send selected option IDs in checkout as `variantOptionIds`.
- For measured items, do not render variant selectors.

## 11. Time Rules

The backend often represents time as minutes after midnight.

```txt
12:00 AM = 0
9:00 AM = 540
12:00 PM = 720
7:00 PM = 1140
11:59 PM = 1439
```

Overnight windows are allowed.

Example:

```txt
8 PM to 2 AM
startMinute = 1200
endMinute = 120
```

Running menu override:

```http
GET /menus/shop/:shopId/running?dayOfWeek=MONDAY&currentMinute=720
```

## 12. Billing System

Billing is not a payment gateway. It is a seller wallet/slot/commission system.

Frontend should model it as:

- Seller sees billing summary and ledger.
- Seller submits a recharge request.
- Admin reviews pending recharge requests.
- Approval updates shop balance/slots/billing status.
- Daily settlement can be run by admin and is also scheduled by backend.
- Company revenue is admin-only.

Main statuses:

```ts
type ShopBillingStatus = "TRIAL" | "ACTIVE" | "PAYMENT_DUE" | "HOLD";
type RechargeStatus = "PENDING" | "APPROVED" | "REJECTED";
```

## 13. Suggested App Navigation

Buyer:

```txt
/login
/buyer/onboarding
/buyer/shops
/buyer/shops/:shopId
/buyer/cart
/buyer/orders
/buyer/orders/:orderId
```

Seller:

```txt
/seller/onboarding
/seller/shop
/seller/items
/seller/combos
/seller/menus
/seller/offers
/seller/banners
/seller/orders
/seller/orders/processed
/seller/revenue
/seller/billing
```

Admin:

```txt
/admin
/admin/users
/admin/buyers
/admin/sellers
/admin/shops
/admin/shop-types
/admin/catalog/cuisines
/admin/catalog/categories
/admin/catalog/items
/admin/tags
/admin/ads
/admin/buyer-ads
/admin/orders
/admin/revenue
/admin/billing
/admin/analytics
```

## 14. Implementation Notes For Frontend

- Build one API client that injects the JWT and unwraps `data`.
- Keep raw backend errors available for debugging, but display `message`.
- Use role-specific layouts rather than one mixed dashboard.
- Cache readonly catalog/shop detail queries on the frontend, but always refetch order status after workflow actions.
- In seller item forms, split fixed pricing and measured pricing modes.
- In shop detail/cart, lock cart to one shop at a time.
- In checkout, validate stock/availability locally for UX, but trust backend as final authority.
- In admin tables, add pagination controls for large lists.
- For image upload forms, send only changed image files; keep existing image URL preview separately.
- Treat route examples in `FRONTEND_API_GUIDE.md` as the deeper endpoint reference when building individual API modules.

