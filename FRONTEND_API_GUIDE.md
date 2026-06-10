# Frontend API Integration Guide

This guide is for frontend developers integrating the backend API. It focuses on role-based flows, allowed request shapes, and the data contracts the UI should send.

Base URL in Postman examples:

```txt
{{baseUrl}}
```

Most routes require JWT auth. Send:

```txt
Authorization: Bearer <token>
```

## Common Response Shape

Successful responses usually follow:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "success message",
  "success": true
}
```

Errors are thrown by the backend with an HTTP status and message. Frontend should display `message`.

## Important IDs

Use these IDs carefully:

| Name | Meaning |
|---|---|
| `itemId` | Master catalog item ID from `Items` |
| `shopItemId` | Seller/shop-owned item ID from `ShopItem` |
| `comboId` | Combo ID |
| `menuId` | Menu ID |
| `shopId` | Shop ID |
| `offerId` | Offer ID |
| `adId` | Seller/buyer placement ad ID |

For menus, combos, offers, and checkout, use `shopItemId` for items selected from a seller shop. Do not send master `itemId` where a shop-owned item is expected.

## Allowed Values

### Days

```txt
MONDAY
TUESDAY
WEDNESDAY
THURSDAY
FRIDAY
SATURDAY
SUNDAY
```

### Shop

```txt
ShopStatus: OPEN | CLOSED | AUTOMATIC
ShopTypes: FASTFOOD | VEGETABLES
```

### Orders

```txt
PaymentMethod: CASH | CARD | UPI
OrderStatus: NEW | PREPARING | READY | DONE | CANCELLED
```

### Ads

```txt
AdPlacement:
SELLER_DASHBOARD
SELLER_HOME
BUYER_EXPLORE
BUYER_SHOP_PAGE

AdTargetMode:
ALL_SELLERS
TARGETED_SELLERS
```

### Offers

```txt
OfferType:
BUY_X_GET_Y
PERCENT_DISCOUNT
FLAT_DISCOUNT
FREE_DELIVERY
COMBO_DISCOUNT

OfferApplyTo:
ALL_CART
SPECIFIC_ITEMS
SPECIFIC_COMBOS
ALL_ITEMS_IN_SELECTED_COMBOS

OfferDiscountType:
PERCENTAGE
FLAT
FREE

OfferAudienceType:
ALL_BUYERS
SPECIFIC_BUYERS
TAG_BASED
PREMIUM_CUSTOMERS
NEW_CUSTOMERS

OfferMenuScope:
ALL_MENUS
SPECIFIC_MENUS

OfferStackingMode:
EXCLUSIVE
STACKABLE
```

## Time And Schedule Rules

The backend stores menu/shop times as minutes after midnight.

```txt
12:00 AM = 0
7:00 AM = 420
12:00 PM = 720
7:00 PM = 1140
11:59 PM = 1439
```

The formula is:

```js
minute = hour * 60 + minute
```

Menu schedules support two request styles.

### Schedule Preset Style

Use this when the UI has simple day presets.

Allowed `scheduleType` values:

```txt
weekdays
weekends
mon-sun
everyday
all-days
```

Payload:

```json
{
  "scheduleType": "weekdays",
  "timeRange": "7am - 7pm"
}
```

The backend expands this into rows:

```txt
weekdays => MONDAY to FRIDAY
weekends => SATURDAY and SUNDAY
mon-sun/everyday/all-days => all 7 days
```

### Explicit Schedule Rows

Use this when the UI has per-day controls.

```json
{
  "schedules": [
    {
      "dayOfWeek": "MONDAY",
      "startMinute": 660,
      "endMinute": 900,
      "active": true
    },
    {
      "dayOfWeek": "TUESDAY",
      "startMinute": 660,
      "endMinute": 900,
      "active": true
    }
  ]
}
```

For overnight menus, `startMinute` can be greater than `endMinute`.

Example:

```txt
8 PM to 2 AM
startMinute = 1200
endMinute = 120
```

Running menu lookup uses server local time unless the frontend passes test overrides:

```txt
GET /menus/shop/{{shopId}}/running?dayOfWeek=MONDAY&currentMinute=720
```

## Seller Flow

### 1. Become/Create Seller Profile

```txt
POST /sellers/create
GET /sellers/me
PATCH /sellers/edit
DELETE /sellers/me
```

Create seller payload:

```json
{
  "name": "Demo Seller",
  "address": "Park Street, Kolkata",
  "latitude": 22.5548,
  "longitude": 88.3516
}
```

### 2. Create Shop

```txt
POST /shops/create
```

Use `multipart/form-data`:

```txt
shopName: Demo Shop
description: Fast food shop
shopCategory: FASTFOOD
latitude: 22.5548
longitude: 88.3516
shopimg: <file>
```

Important: shop timings are not created in this payload now. Use shop timings endpoint separately.

### 3. Set Shop Timings

```txt
PATCH /shops/{{shopId}}/timings
```

Payload:

```json
{
  "shopOpenStatus": "AUTOMATIC",
  "timings": [
    {
      "dayOfWeek": "MONDAY",
      "openingTime": "9:00am",
      "closingTime": "10:30pm"
    },
    {
      "dayOfWeek": "TUESDAY",
      "openingTime": "10:00",
      "closingTime": "18:00"
    }
  ]
}
```

Time strings accepted by parser:

```txt
9am
9:00am
10:30pm
18:00
```

### 4. Toggle Shop Status

```txt
PATCH /shops/{{shopId}}/status
```

Payload:

```json
{
  "status": "AUTOMATIC"
}
```

Allowed:

```txt
OPEN
CLOSED
AUTOMATIC
```

### 5. Seller Adds Item To Shop

```txt
POST /items/custom
```

Use `multipart/form-data`:

```txt
shopId: {{shopId}}
itemId: {{itemId}}
pricing: 120
availableQuantity: 50
description: Seller-specific item description
sortOrderId: 1
active: true
itemImg: <file>
```

No item-level discount fields are used. Discounts are handled through offers.

To create a custom seller item without existing master item:

```txt
shopId: {{shopId}}
itemName: Chicken kebab
categoryName: Fastfood
cuisineName: Bengali
pricing: 150
availableQuantity: 75
active: true
itemImg: <file>
```

### 6. Fetch Shop Items

```txt
GET /items/shop/{{shopId}}
GET /items/shop/{{shopId}}?cuisineName=Bengali&categoryName=Fastfood
```

Response contains `items[]`; use `items[].id` as `shopItemId`.

### 7. Update Seller Shop Item

```txt
PATCH /items/shop-items/{{shopItemId}}
```

Use `multipart/form-data`:

```txt
pricing: 150
availableQuantity: 75
description: Updated seller item
imageUrl: https://example.com/item.jpg
sortOrderId: 2
active: true
```

### 8. Create Combo

```txt
POST /combos/create
```

Payload:

```json
{
  "shopId": "{{shopId}}",
  "name": "Shop Item Test Combo",
  "description": "Combo using shop item IDs",
  "imageUrl": "https://example.com/combo.jpg",
  "cuisineName": "Bengali",
  "categoryName": "Fastfood",
  "discount": 10,
  "percentageDiscount": 0,
  "availableQuantity": 20,
  "sortOrderId": 1,
  "items": [
    {
      "itemId": "{{shopItemId}}",
      "quantity": 1
    }
  ]
}
```

Combo total is calculated from base shop item prices. Combo-level `discount` and `percentageDiscount` still exist.

### 9. Fetch Combos

```txt
GET /combos/shop/{{shopId}}
GET /combos/classification?shopId={{shopId}}&cuisineName=Bengali&categoryName=Fastfood
GET /combos/builder?shopId={{shopId}}
```

`/combos/builder` helps frontend discover valid `shopItemId` values.

### 10. Create Menu

```txt
POST /menus/create
```

Preset schedule payload:

```json
{
  "shopId": "{{shopId}}",
  "name": "Breakfast Menu",
  "description": "Available in the morning",
  "active": true,
  "sortOrderId": 1,
  "scheduleType": "weekdays",
  "timeRange": "7am - 7pm",
  "items": [
    {
      "itemId": "{{shopItemId}}",
      "active": true,
      "sortOrderId": 1
    }
  ],
  "combos": [
    {
      "comboId": "{{comboId}}",
      "active": true,
      "sortOrderId": 2
    }
  ]
}
```

Explicit schedule payload:

```json
{
  "shopId": "{{shopId}}",
  "name": "Lunch Menu",
  "active": true,
  "schedules": [
    {
      "dayOfWeek": "MONDAY",
      "startMinute": 660,
      "endMinute": 900,
      "active": true
    }
  ],
  "itemIds": ["{{shopItemId}}"],
  "comboIds": ["{{comboId}}"]
}
```

### 11. Fetch Running Menus

```txt
GET /menus/shop/{{shopId}}/running
GET /menus/shop/{{shopId}}/running?dayOfWeek=MONDAY&currentMinute=720
```

Use the second form for testing.

### 12. Offers Management

```txt
POST /offers/create
GET /offers/shop/{{shopId}}
GET /offers/{{offerId}}
PATCH /offers/{{offerId}}
PATCH /offers/{{offerId}}/active
DELETE /offers/{{offerId}}
GET /offers/shop/{{shopId}}/buyers/search?query=demo
```

Cart-level 10% discount:

```json
{
  "shopId": "{{shopId}}",
  "title": "Cart 10% Discount",
  "description": "10% discount on full cart subtotal",
  "offerType": "PERCENT_DISCOUNT",
  "active": true,
  "startsAt": "2026-06-10T09:00:00.000Z",
  "endsAt": "2026-06-30T21:00:00.000Z",
  "menuScope": "ALL_MENUS",
  "applyTo": "ALL_CART",
  "minQuantity": 1,
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "audienceType": "ALL_BUYERS",
  "stackingMode": "EXCLUSIVE"
}
```

Specific item discount:

```json
{
  "shopId": "{{shopId}}",
  "title": "Item Discount",
  "offerType": "PERCENT_DISCOUNT",
  "active": true,
  "startsAt": "2026-06-10T09:00:00.000Z",
  "endsAt": "2026-06-30T21:00:00.000Z",
  "menuScope": "ALL_MENUS",
  "applyTo": "SPECIFIC_ITEMS",
  "itemIds": ["{{shopItemId}}"],
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "audienceType": "ALL_BUYERS",
  "stackingMode": "EXCLUSIVE"
}
```

Specific combo discount:

```json
{
  "shopId": "{{shopId}}",
  "title": "Combo Discount",
  "offerType": "COMBO_DISCOUNT",
  "active": true,
  "startsAt": "2026-06-10T09:00:00.000Z",
  "endsAt": "2026-06-30T21:00:00.000Z",
  "menuScope": "ALL_MENUS",
  "applyTo": "SPECIFIC_COMBOS",
  "comboIds": ["{{comboId}}"],
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "audienceType": "ALL_BUYERS",
  "stackingMode": "EXCLUSIVE"
}
```

Free delivery:

```json
{
  "shopId": "{{shopId}}",
  "title": "Free Delivery",
  "offerType": "FREE_DELIVERY",
  "active": true,
  "startsAt": "2026-06-10T09:00:00.000Z",
  "endsAt": "2026-06-30T21:00:00.000Z",
  "menuScope": "ALL_MENUS",
  "applyTo": "ALL_CART",
  "discountType": "FREE",
  "audienceType": "ALL_BUYERS",
  "stackingMode": "EXCLUSIVE"
}
```

### 13. Seller Order Flow

```txt
GET /orders/seller
GET /orders/seller/processed
PATCH /orders/{{orderId}}/payment-received
PATCH /orders/{{orderId}}/confirm
PATCH /orders/{{orderId}}/ready
PATCH /orders/{{orderId}}/complete
PATCH /orders/{{orderId}}/refund
```

Order status flow:

```txt
NEW -> PREPARING -> READY -> DONE
```

Confirm order:

```txt
PATCH /orders/{{orderId}}/confirm
```

This decrements item/combo inventory.

Mark ready:

```txt
PATCH /orders/{{orderId}}/ready
```

Complete order:

```txt
PATCH /orders/{{orderId}}/complete
```

Refund completed order:

```txt
PATCH /orders/{{orderId}}/refund
```

Body:

```json
{}
```

Refund amount is automatic:

```txt
refund remaining = paidAmount - existingRefundAmount
```

## Buyer Flow

### 1. Become/Create Buyer Profile

```txt
POST /buyers/create
GET /buyers/me
DELETE /buyers/me
```

Payload:

```json
{
  "name": "Demo Buyer",
  "address": "Salt Lake, Kolkata",
  "latitude": 22.5726,
  "longitude": 88.3639
}
```

### 2. Find Nearby Shops

```txt
GET /shops/nearby?radius=10&status=ALL
```

Query params:

| Param | Meaning |
|---|---|
| `radius` | distance in km |
| `status` | `ALL`, `OPEN`, `CLOSED`, `AUTOMATIC` |

The buyer must have latitude and longitude saved.

### 3. Shop Details

```txt
GET /shops/find/{{shopId}}
GET /shops/findshop/{{slug}}
```

Use this to show shop page, items, combos, timings, and active data.

### 4. Running Menu

```txt
GET /menus/shop/{{shopId}}/running
```

Use this to show currently available menus. For testing:

```txt
GET /menus/shop/{{shopId}}/running?dayOfWeek=MONDAY&currentMinute=720
```

### 5. Available Offers

```txt
GET /offers/shop/{{shopId}}/available
```

This returns offers available to the current buyer based on audience rules.

### 6. Checkout

```txt
POST /orders/checkout
```

Without offer:

```json
{
  "shopId": "{{shopId}}",
  "paymentMethod": "CASH",
  "paymentReceived": false,
  "deliveryAmount": 0,
  "customerNote": "Please prepare fresh.",
  "items": [
    {
      "shopItemId": "{{shopItemId}}",
      "quantity": 1
    }
  ],
  "combos": [
    {
      "comboId": "{{comboId}}",
      "quantity": 1
    }
  ]
}
```

With offer:

```json
{
  "shopId": "{{shopId}}",
  "paymentMethod": "CASH",
  "paymentReceived": false,
  "deliveryAmount": 0,
  "offerIds": ["{{offerId}}"],
  "items": [
    {
      "shopItemId": "{{shopItemId}}",
      "quantity": 1
    }
  ],
  "combos": [
    {
      "comboId": "{{comboId}}",
      "quantity": 1
    }
  ]
}
```

Offer input can be one of:

```txt
offerId
offerIds
appliedOfferIds
```

Checkout stores:

```txt
subtotalAmount = items + combos
discountAmount = offer discount on cart/items/combos
deliveryDiscountAmount = free delivery discount
totalAmount = subtotalAmount - discountAmount + deliveryAmount - deliveryDiscountAmount
```

### 7. Buyer Orders

```txt
GET /orders/my
PATCH /orders/{{orderId}}/cancel
```

Cancel payload:

```json
{
  "refundAmount": 0
}
```

## Admin Flow

### 1. Users

```txt
GET /users
GET /users/sellers
GET /users/buyers
PATCH /users/suspend/{{userId}}
PATCH /users/modUser/{{userId}}
DELETE /users/delUser/{{userId}}
```

Admin can also create buyer/seller profiles for existing users:

```txt
POST /buyers/create/{{userId}}
POST /sellers/create/{{userId}}
```

### 2. Master Cuisines

```txt
POST /cuisines/create
GET /cuisines
GET /cuisines/only
PATCH /cuisines/reorder
PATCH /cuisines/{{cuisineId}}
DELETE /cuisines/{{cuisineId}}
```

Create payload:

```json
{
  "name": "Bengali",
  "sortOrderId": 1
}
```

Reorder payload:

```json
{
  "cuisineIds": ["{{cuisineId1}}", "{{cuisineId2}}"]
}
```

### 3. Master Categories

```txt
POST /categories/create
POST /categories/map
GET /categories/fetchallcategories
GET /categories/only
GET /categories/shop/{{shopId}}
GET /categories/cuisine?cuisineName=Bengali
PATCH /categories/reorder
PATCH /categories/{{categoryId}}
DELETE /categories/{{categoryId}}
```

Create payload:

```json
{
  "name": "Fastfood",
  "sortOrderId": 1,
  "cuisineName": "Bengali"
}
```

### 4. Master Items

```txt
POST /items/create
POST /items/map
GET /items
GET /items/only
GET /items/category?categoryName=Fastfood
PATCH /items/reorder
PATCH /items/{{itemId}}
DELETE /items/{{itemId}}
```

Create item uses `multipart/form-data`:

```txt
name: Chicken kebab
description: Master catalog item
categoryName: Fastfood
cuisineName: Bengali
sortOrderId: 1
itemImg: <file>
```

### 5. Tags

```txt
POST /tags/create
GET /tags
GET /tags/active
GET /tags/{{tagId}}
PATCH /tags/{{tagId}}
PATCH /tags/{{tagId}}/active
DELETE /tags/{{tagId}}
POST /tags/items/{{itemId}}
DELETE /tags/items/{{itemId}}/{{tagId}}
POST /tags/combos/{{comboId}}
DELETE /tags/combos/{{comboId}}/{{tagId}}
```

Create tag:

```json
{
  "name": "Hot Selling",
  "slug": "HOT_SELLING",
  "active": true
}
```

### 6. Shop Admin

```txt
PATCH /shops/start/{{shopId}}
PATCH /shops/{{shopId}}/trial
PATCH /shops/{{shopId}}/timings
PATCH /shops/{{shopId}}/status
PATCH /shops/{{shopId}}/settings
DELETE /shops/revoke/{{shopId}}
```

Trial payload:

```json
{
  "trialDays": 30
}
```

### 7. Ads

```txt
POST /ads/create
GET /ads/fetchAll
GET /ads/fetchAll?placement={{adPlacement}}&shopId={{shopId}}
GET /ads/fetchAll?everything=true
GET /ads/seller?placement=SELLER_DASHBOARD
GET /ads/buyer?placement=BUYER_EXPLORE&shopId={{shopId}}
PATCH /ads/{{adId}}/active
DELETE /ads/{{adId}}
```

Create ad uses `multipart/form-data`.

Common fields:

```txt
name: Summer Campaign
description: Promotion visible across ad slots
placements: ["SELLER_DASHBOARD","BUYER_EXPLORE"]
targetMode: ALL_SELLERS
startsAt: 2026-06-10T09:00:00.000Z
endsAt: 2026-06-30T21:00:00.000Z
active: true
```

Image fields by placement:

| Placement | File field |
|---|---|
| `SELLER_DASHBOARD` | `sellerDashboardImg` |
| `SELLER_HOME` | `sellerHomeImg` |
| `BUYER_EXPLORE` | `buyerExploreImg` |
| `BUYER_SHOP_PAGE` | `buyerShopPageImg` |

Seller dashboard ad fetch:

```txt
GET /ads/seller?placement=SELLER_DASHBOARD
```

Buyer explore/shop ad fetch:

```txt
GET /ads/buyer?placement=BUYER_EXPLORE
GET /ads/buyer?placement=BUYER_SHOP_PAGE&shopId={{shopId}}
```

### 8. Buyer Side Ads

```txt
GET /ads/buyer-ads
POST /ads/buyer-ads/admin
GET /ads/buyer-ads/admin
GET /ads/buyer-ads/admin/{{buyerAdId}}
PATCH /ads/buyer-ads/admin/{{buyerAdId}}
PATCH /ads/buyer-ads/admin/{{buyerAdId}}/active
DELETE /ads/buyer-ads/admin/{{buyerAdId}}
```

Use these for buyer-targeted ads managed by admin.

### 9. Revenue

```txt
GET /revenue/shop/{{shopId}}
GET /revenue/shop/{{shopId}}/repeat-customers
```

Used by seller/admin dashboards for revenue summaries and repeat customer insights.

### 10. Processed Orders

```txt
GET /orders/processed/all
```

Admin can view all completed orders.

## Frontend Application Map

### Seller App Screens

Recommended flow:

```txt
Login
-> Seller profile
-> Create/edit shop
-> Set timings/status
-> Add shop items
-> Create combos
-> Create menus
-> Create offers
-> Manage active orders
-> Revenue dashboard
```

Main APIs:

```txt
/sellers/*
/shops/*
/items/custom
/items/shop/:shopId
/combos/*
/menus/*
/offers/*
/orders/seller
/revenue/shop/:shopId
/ads/seller
```

### Buyer App Screens

Recommended flow:

```txt
Login
-> Buyer profile/location
-> Nearby shops
-> Shop detail
-> Running menu
-> Cart
-> Available offers
-> Checkout
-> My orders
```

Main APIs:

```txt
/buyers/*
/shops/nearby
/shops/find/:shopId
/shops/findshop/:slug
/menus/shop/:shopId/running
/offers/shop/:shopId/available
/orders/checkout
/orders/my
/ads/buyer
/ads/buyer-ads
```

### Admin App Screens

Recommended flow:

```txt
Login
-> Users
-> Master cuisines/categories/items/tags
-> Shops
-> Ads
-> Offers support
-> Orders
-> Revenue
```

Main APIs:

```txt
/users/*
/buyers/create/:userId
/sellers/create/:userId
/cuisines/*
/categories/*
/items/*
/tags/*
/shops/start/:shopId
/shops/:shopId/trial
/ads/*
/orders/processed/all
/revenue/shop/:shopId
```

## Common Frontend Gotchas

1. Use `shopItemId`, not master `itemId`, when ordering, creating combos, creating menus, or targeting item offers.
2. Item discount fields are removed. Use offers for discounts.
3. Cart-level discount requires `applyTo: "ALL_CART"`.
4. Running menus use server-local time unless `dayOfWeek` and `currentMinute` are passed.
5. For file uploads, use `multipart/form-data`.
6. Combo `finalPrice` may include combo-level discount.
7. Checkout line item prices are stored as `priceAtOrderTime`.
8. Completed order refund is automatic: `PATCH /orders/:orderId/refund` with `{}` refunds the remaining paid amount.
