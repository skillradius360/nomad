# eLabAssist Backend API Route And Controller Flow Guide

This file is the frontend and handoff reference for the live Express backend.
It is matched against `src/app.js`, every active file in `src/routes`, and the
controller functions currently exported from `src/controllers`.

Base URL:

```txt
{{baseUrl}} = http://localhost:8000
```

Auth:

```txt
Authorization: Bearer {{accessToken}}
```

The same `accessToken` collection variable is used for every role. The backend
checks the user role inside the JWT. Login as an admin when calling admin routes,
as a seller for seller-owned routes, and as a buyer for buyer routes.

Most JSON success responses use:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "success message",
  "success": true
}
```

Most errors use:

```json
{
  "success": false,
  "message": "readable error message",
  "stack": "development stack"
}
```

File upload routes use `multipart/form-data`. Do not manually set
`Content-Type` when using browser `FormData`.

## Core IDs

| ID | Meaning |
|---|---|
| `userId` | User account ID |
| `buyerId` | Buyer user ID in admin routes, or buyer profile/user relation depending on context |
| `sellerId` | Seller user ID in admin routes, or seller profile/user relation depending on context |
| `shopId` | Shop ID |
| `shopTypeId` | Shop type ID |
| `cuisineId` | Cuisine ID |
| `categoryId` | Category ID |
| `itemId` | Master `Items` ID |
| `shopItemId` | Seller-owned `ShopItem` ID. Use this for checkout, combos, menus, and shop item offers |
| `comboId` | Combo ID |
| `menuId` | Menu ID |
| `orderId` | Order ID |
| `adId` | Seller/buyer placement ad ID |
| `buyerAdId` | Buyer-side global ad ID |
| `tagId` | Tag ID |
| `offerId` | Offer ID |
| `bannerId` | Banner ID |
| `optionId` | Recharge day/amount option ID |
| `rechargeId` | Recharge request ID |

## Common Enums

```txt
UserRole: ADMIN | SELLER | BUYER
DayOfWeek: MONDAY | TUESDAY | WEDNESDAY | THURSDAY | FRIDAY | SATURDAY | SUNDAY
ShopStatus: OPEN | CLOSED | AUTOMATIC
ShopFeatureKey: ITEMS | CATEGORIES | CUISINE | MENUS | COMBOS
ShopItemPricingMode: FIXED | MEASURED
ShopItemUnit: KG | GRAM | LITER | ML | PIECE | DOZEN | METER | CM | PACKET | BOX | BOTTLE
PaymentMethod: CASH | CARD | UPI
OrderStatus: NEW | PREPARING | READY | DONE | CANCELLED
AdPlacement: SELLER_DASHBOARD | SELLER_HOME | BUYER_EXPLORE | BUYER_SHOP_PAGE
AdTargetMode: ALL_SELLERS | TARGETED_SELLERS
OfferType: BUY_X_GET_Y | PERCENT_DISCOUNT | FLAT_DISCOUNT | FREE_DELIVERY | COMBO_DISCOUNT
OfferApplyTo: ALL_CART | SPECIFIC_ITEMS | SPECIFIC_COMBOS | ALL_ITEMS_IN_SELECTED_COMBOS
OfferDiscountType: PERCENTAGE | FLAT | FREE
OfferAudienceType: ALL_BUYERS | SPECIFIC_BUYERS | TAG_BASED | PREMIUM_CUSTOMERS | NEW_CUSTOMERS
OfferMenuScope: ALL_MENUS | SPECIFIC_MENUS
OfferStackingMode: EXCLUSIVE | STACKABLE
BillingRechargeStatus: PENDING | APPROVED | REJECTED
```

## Mounted Routers

| Mount | Route file | Controller area |
|---|---|---|
| `/auth` | `src/routes/auth.routes.js` | `src/controllers/auth/Oauth.controller.js` |
| `/users` | `src/routes/user.routes.js` | `src/controllers/users/user.controller.js` |
| `/shops` | `src/routes/shop.routes.js` | `src/controllers/shop/shop.controller.js` |
| `/shop-types` | `src/routes/shopTypes.routes.js` | `src/controllers/shopTypes/shopTypes.controller.js` |
| `/buyers` | `src/routes/buyer.routes.js` | `src/controllers/buyers/buyer.controller.js` |
| `/sellers` | `src/routes/seller.routes.js` | `src/controllers/sellers/seller.controller.js` |
| `/cuisines` | `src/routes/cuisine.routes.js` | `src/controllers/cuisine/cuisine.controller.js` |
| `/categories` | `src/routes/categories.routes.js` | `src/controllers/categories/categories.controller.js` |
| `/items` | `src/routes/items.routes.js` | `src/controllers/items/items.controller.js` |
| `/combos` | `src/routes/combos.routes.js` | `src/controllers/combos/combos.controller.js` |
| `/menus` | `src/routes/menu.routes.js` | `src/controllers/menu/menu.controller.js` |
| `/orders` | `src/routes/orders.routes.js` | `src/controllers/orders/orders.controller.js` |
| `/ads` | `src/routes/ads.routes.js` | `src/controllers/ad/ad.controller.js`, `src/controllers/ad/buyerAd.controller.js` |
| `/tags` | `src/routes/tags.routes.js` | `src/controllers/tags/tags.controller.js` |
| `/offers` | `src/routes/offers.routes.js` | `src/controllers/offers/offers.controller.js` |
| `/revenue` | `src/routes/revenue.routes.js` | `src/controllers/revenue/revenue.controller.js` |
| `/banners` | `src/routes/banners.routes.js` | `src/controllers/banners/banner.controller.js` |
| `/billing` | `src/routes/billing.routes.js` | `src/controllers/billing/billing.controller.js` |
| `/analytics` | `src/routes/analytics.routes.js` | `src/controllers/analytics/analytics.controller.js` |

## Health And Root

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/` | Public | inline in `src/app.js` | Returns the HTML logo page. |
| `GET` | `/health` | Public | `healthCheck` in `src/app.js` | Returns a simple health JSON with any decoded user data if present. |

## Auth Flow

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/auth/google` | Public | `googleAuth` | Redirects the browser to Google OAuth. |
| `GET` | `/auth/google/callback?code=` | Public | `googleCallback` | Exchanges Google code, finds/creates user, returns `accessToken`, `refreshToken`, and user data. |
| `POST` | `/auth/generateOTP` | Public, rate-limited | `otpAuth` | Accepts phone, creates OTP, stores expiry, sends/returns OTP flow data. |
| `POST` | `/auth/verifyOTP` | Public, rate-limited | `otpCheck` | Accepts `phoneNo` and `otp`, validates active OTP, returns auth tokens and user data. |
| `DELETE` | `/auth/invalidateOTP` | Public | `invalidateExpiredOtp` | Deletes expired OTP records. |

## Users Flow

All `/users` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/users/all-data?take=10` | Admin | `fetchAllUserOverviewData` | Builds admin dashboard overview: users, sellers, buyers, orders, revenue, recent activity, and unavailable data flags. |
| `GET` | `/users` | Admin | `fetchAllUsers` | Lists users with pagination. |
| `GET` | `/users/admin/shops?page=1&limit=20&sort=highestSales&search=` | Admin | `fetchAdminShops` | Lists shops for admin with pagination, search, status/billing/verified/live filters, and sales/revenue/new-joining sorting. |
| `GET` | `/users/admin/shops/:shopId` | Admin | `fetchAdminShopById` | Returns one shop detail, owner, shop type, order metrics, item/combo/menu counts, billing/trial/delivery/location, and recent orders. |
| `GET` | `/users/admin/buyers` | Admin | `fetchAllBuyers` | Lists buyer users. |
| `GET` | `/users/admin/buyers/:buyerId` | Admin | `fetchAdminBuyerById` | Returns buyer profile, recent orders, order count, and spend summary. |
| `PATCH` | `/users/admin/buyers/:buyerId/status` | Admin | `updateAdminUserStatus` | Blocks/unblocks buyer using `isBlocked`, `blocked`, or `status: ACTIVE/BLOCKED/SUSPENDED`. |
| `GET` | `/users/admin/sellers` | Admin | `fetchAllSellers` | Lists seller users. |
| `GET` | `/users/admin/sellers/:sellerId` | Admin | `fetchAdminSellerById` | Returns seller profile, shops, and revenue/order summary across shops. |
| `PATCH` | `/users/admin/sellers/:sellerId/status` | Admin | `updateAdminUserStatus` | Blocks/unblocks seller using `isBlocked`, `blocked`, or `status`. |
| `PATCH` | `/users/suspend/:userId` | Admin | `toggleUserSuspension` | Toggles `isBlocked` for a user. |
| `GET` | `/users/sellers?skip=0` | Admin | `fetchAllSellers` | Legacy seller list endpoint. |
| `GET` | `/users/buyers?skip=0` | Admin | `fetchAllBuyers` | Legacy buyer list endpoint. |
| `DELETE` | `/users/delUser/:userId` | Admin or self | `deleteUser` | Deletes a user account after access check. |
| `PATCH` | `/users/modUser/:userId` | Admin or self | `editUserData` | Updates another user/self based on access. Admin can modify role/verification style fields. |
| `GET` | `/users/me` | Authenticated | `fetchUserProfile` | Returns the current user profile. |
| `PATCH` | `/users/me` | Authenticated | `editOwnUserData` | Updates current user fields and optional `avatar` file. |

## Buyers Flow

All `/buyers` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/buyers/create/:userId` | Admin | `createBuyerByAdmin` | Creates buyer profile for a specific user. |
| `POST` | `/buyers/create` | Authenticated | `createBuyer` | Creates buyer profile for current user. |
| `GET` | `/buyers/me` | Buyer | `getBuyerProfile` | Returns buyer profile for current buyer. |
| `PATCH` | `/buyers/me` | Buyer | `editBuyerProfile` | Updates current buyer profile. |
| `DELETE` | `/buyers/me` | Buyer | `deleteBuyer` | Deletes current buyer profile/user flow. |
| `PATCH` | `/buyers/:userId` | Admin or matching buyer | `editBuyerProfile` | Updates a buyer profile by user ID. |

## Sellers Flow

All `/sellers` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/sellers/create/:userId` | Admin | `createSellerByAdmin` | Creates seller profile for a specific user. |
| `POST` | `/sellers/create` | Authenticated | `createSeller` | Creates seller profile for current user. |
| `GET` | `/sellers/me` | Seller | `getSellerProfile` | Returns seller profile and related seller data. |
| `DELETE` | `/sellers/me` | Seller | `deleteSeller` | Deletes current seller profile/user flow. |
| `PATCH` | `/sellers/edit` | Seller | `updateSellerProfile` | Updates current seller profile. |
| `PATCH` | `/sellers/:userId` | Admin or matching seller | `updateSellerProfile` | Updates a seller profile by user ID. |

## Shops Flow

All `/shops` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/shops?page=1&limit=20` | Authenticated | `fetchAllShops` | Lists shops with pagination for general browsing. |
| `GET` | `/shops/admin/all?page=1&limit=20` | Admin | `fetchAllShops` | Admin shop list using the same controller with admin access. |
| `PATCH` | `/shops/start/:shopId` | Admin | `makeSellerGoLive` | Verifies/starts a seller shop and initializes billing/trial status where applicable. |
| `GET` | `/shops/nearby?radius=10&status=ALL` | Buyer | `findNearbyShops` | Finds nearby shops using buyer location, radius, status, pagination, and distance calculation. |
| `GET` | `/shops/:shopId/customers?page=1&limit=20` | Admin or shop seller | `fetchShopCustomers` | Lists customers for a shop from completed order history. |
| `PATCH` | `/shops/:shopId/trial` | Admin | `setShopTrialPeriod` | Sets trial start/end by `trialDays`, `days`, `trialStartedAt`, or `startsAt`. |
| `PATCH` | `/shops/:shopId/timings` | Admin or shop seller | `setShopTimings` | Replaces/updates shop schedule using opening/closing times, open days, or timing rows. |
| `PATCH` | `/shops/:shopId/status` | Admin or shop seller | `setShopStatus` | Sets or toggles shop open status: `OPEN`, `CLOSED`, or `AUTOMATIC`. |
| `PATCH` | `/shops/:shopId/availability` | Admin or shop seller | `toggleShopAvailability` | Toggles or explicitly sets shop open status and delivery availability. |
| `PATCH` | `/shops/:shopId/settings` | Admin or shop seller | `editShopSettings` | Edits shop profile/settings, image, location, delivery, tags, type, and feature flags such as combos/menus/items. |
| `GET` | `/shops/find/:shopId` | Authenticated | `findFullShopData` | Returns full shop detail for buyer/frontend views including items, combos, menus, banners, and features. |
| `GET` | `/shops/findshop/:slug` | Authenticated | `findByShopSlug` | Finds a shop by slug. |
| `DELETE` | `/shops/revoke/:shopId` | Admin | `deleteSeller` in shop controller | Revokes/deletes seller shop access for a shop. |
| `POST` | `/shops/create` | Admin or seller | `createShop` | Creates a shop with optional `shopimg`, location, type, timing/settings fields, and feature configuration. |

## Shop Types And Feature Overrides Flow

All `/shop-types` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/shop-types?includeInactive=false` | Authenticated | `fetchShopTypes` | Lists active shop types and their default feature keys. |
| `POST` | `/shop-types` | Admin | `createShopType` | Creates a shop type with `name`, optional `slug`, `description`, `active`, and `features`. |
| `GET` | `/shop-types/shops/:shopId/features` | Admin | `fetchShopFeatureOverrides` | Returns effective/default/overridden features for one shop. |
| `PATCH` | `/shop-types/shops/:shopId/features` | Admin | `updateShopFeatureOverrides` | Enables/disables one or multiple features for a shop override. |
| `DELETE` | `/shop-types/shops/:shopId/features` | Admin | `deleteShopFeatureOverrides` | Removes one, many, or all feature overrides for a shop. |
| `GET` | `/shop-types/:shopTypeId` | Authenticated | `fetchShopTypeById` | Returns one shop type with features. |
| `PATCH` | `/shop-types/:shopTypeId` | Admin | `updateShopType` | Updates shop type metadata and feature list. |
| `DELETE` | `/shop-types/:shopTypeId` | Admin | `deleteShopType` | Deletes a shop type if safe. |

## Cuisine Flow

All `/cuisines` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/cuisines` | Authenticated | `fetchAllCuisines` | Lists cuisines with category relationships. |
| `POST` | `/cuisines/create` | Admin | `createCuisine` | Creates a cuisine with name/slug/sort order. |
| `PATCH` | `/cuisines/reorder` | Admin | `reorderCuisines` | Reorders cuisines by ID array. |
| `GET` | `/cuisines/fetchallcuisines` | Authenticated | `fetchAllCuisines` | Legacy alias for full cuisine list. |
| `GET` | `/cuisines/only` | Authenticated | `fetchOnlyCuisines` | Returns compact cuisine rows. |
| `GET` | `/cuisines/shop/:shopId` | Authenticated | `fetchShopCuisines` | Returns cuisines represented by a shop inventory/menu/combo data. |
| `PATCH` | `/cuisines/:cuisineId` | Admin | `editCuisine` | Updates cuisine fields. |
| `DELETE` | `/cuisines/:cuisineId` | Admin | `deleteCuisine` | Deletes a cuisine. |

## Categories Flow

All `/categories` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/categories/create` | Admin | `createCategory` | Creates a category with optional cuisine mapping and sort order. |
| `POST` | `/categories/map` | Admin | `mapCategories` | Maps existing or named categories to a cuisine. |
| `PATCH` | `/categories/reorder` | Admin | `reorderCategories` | Reorders categories, optionally within cuisine context. |
| `GET` | `/categories/fetchallcategories` | Authenticated | `fetchAllCategories` | Lists categories with related cuisine/items. |
| `GET` | `/categories/only` | Authenticated | `fetchOnlyCategories` | Returns compact active categories. |
| `GET` | `/categories/shop/:shopId` | Authenticated | `fetchShopCategories` | Returns categories represented in a shop's inventory/combos/menus. |
| `GET` | `/categories/cuisine?cuisineName=` | Authenticated | `fetchCategoryToCuisine` | Finds categories by cuisine name query. |
| `GET` | `/categories/cuisine/:cuisineName` | Authenticated | `fetchCategoryToCuisine` | Finds categories by cuisine name path param. |
| `PATCH` | `/categories/:categoryId` | Admin | `editCategory` | Updates category metadata/cuisine mapping. |
| `DELETE` | `/categories/:categoryId` | Admin | `deleteCategory` | Deletes a category. |

## Items, Shop Items, Variants, And Measured Pricing Flow

All `/items` routes require `verifyJWT`.

Important rules:

- Master items live in `Items`.
- Seller inventory lives in `ShopItem`.
- Use `shopItemId` for checkout, combos, menus, and item offers.
- Fixed-price shop items use `pricing`.
- Measured shop items use `pricingMode: MEASURED`, `unit`, `displayUnit`, `pricePerUnit`, `quantityStep`, `minOrderQuantity`, and optional `availableQuantityValue`.
- Variants are configured on shop items using `variantGroups` and options. They are not a separate route group.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/items?page=1&limit=50` | Authenticated | `fetchAllItems` | Lists master items with pagination and category/tag info. |
| `POST` | `/items/create` | Admin or seller | `createItems` | Creates master item with optional image, category/cuisine mapping, sort order, and optional `tagIds`. |
| `POST` | `/items/map` | Admin | `mapItems` | Maps named/existing master items to category and cuisine. |
| `POST` | `/items/custom` | Seller | `addPersonalProduct` | Adds a master item to a seller shop as `ShopItem`, with fixed or measured pricing, optional variants, image, stock, and description. |
| `PATCH` | `/items/reorder` | Admin | `reorderItems` | Reorders master items in category/cuisine context. |
| `PATCH` | `/items/shop-items/reorder` | Admin or seller | `reorderShopItems` | Reorders seller shop items. |
| `GET` | `/items/fetchallitems` | Authenticated | `fetchAllItems` | Legacy alias for master item list. |
| `GET` | `/items/only` | Authenticated | `fetchOnlyItems` | Returns compact master item list. |
| `PATCH` | `/items/shop-items/:shopItemId` | Admin or owner seller | `editShopItem` | Updates shop item pricing, measured fields, variants, image, stock, active state, and description. Sending `variantGroups` replaces variant config. |
| `DELETE` | `/items/shop-items/:shopItemId` | Admin or owner seller | `deleteShopItem` | Deletes/removes a shop item from seller inventory. |
| `GET` | `/items/shop/:shopId?page=1&limit=20` | Authenticated | `fetchItemsByShop` | Lists shop inventory with item details, category/cuisine filters, variants, measured pricing, and pagination. |
| `GET` | `/items/category?categoryName=` | Authenticated | `fetchItemsToCategory` | Lists master items by category from query/body. |
| `GET` | `/items/category/:categoryName` | Authenticated | `fetchItemsToCategory` | Lists master items by category path param. |
| `PATCH` | `/items/:itemId` | Admin | `editItem` | Updates master item fields, image, category/cuisine, tags, active state, and sort order. |
| `DELETE` | `/items/:itemId` | Admin | `deleteItem` | Deletes/deactivates a master item. |

## Combos Flow

All `/combos` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/combos/builder?shopId=&categoryId=` | Authenticated | `comboBuilder` | Returns shop-owned inventory data needed to build a combo. |
| `GET` | `/combos/classification?shopId=&cuisineName=&categoryName=` | Authenticated | `fetchCombosByClassification` | Lists combos filtered by shop and classification. |
| `GET` | `/combos/shop/:shopId?page=1&limit=20` | Authenticated | `getCombosByShop` | Lists active shop combos with lowest item pricing support for menus/combo UI. |
| `POST` | `/combos/create` | Seller or admin by controller checks | `createCombo` | Creates combo from shop item IDs, computes total price/final price, validates ownership and measured-item restrictions. |
| `PATCH` | `/combos/:comboId` | Seller or admin by controller checks | `editCombo` | Updates combo metadata, classification, active state, stock, and replaces combo items if provided. |
| `DELETE` | `/combos/:comboId` | Seller or admin by controller checks | `deleteCombo` | Deletes a combo after ownership/access checks. |

## Menus Flow

All `/menus` routes require `verifyJWT`.

Schedule can be sent as preset fields (`scheduleType`, `schedulePreset`, `timeRange`)
or explicit `schedules` rows.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/menus/shop/:shopId/running?page=1&limit=10` | Authenticated | `fetchRunningMenusByShop` | Returns menus active for current or supplied `dayOfWeek`/`currentMinute`, including items/combos and pagination. |
| `POST` | `/menus/create` | Seller or admin by controller checks | `createMenu` | Creates menu, validates shop ownership, schedule rows, shop item IDs, combo IDs, and sort order. |
| `PATCH` | `/menus/reorder` | Seller or admin by controller checks | `reorderMenus` | Reorders menus for a shop. |
| `PATCH` | `/menus/:menuId` | Seller or admin by controller checks | `editMenu` | Updates menu metadata, active state, schedules, items, and combos. |
| `DELETE` | `/menus/:menuId` | Seller or admin by controller checks | `deleteMenu` | Deletes a menu after access checks. |

## Orders Flow

All `/orders` routes require `verifyJWT`.

Main order lifecycle:

```txt
Buyer checkout -> NEW
Seller confirm -> PREPARING
Seller ready -> READY
Seller complete -> DONE
Any allowed actor cancel before completion -> CANCELLED
Seller refund completed paid order -> DONE with refund amount
```

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/orders/checkout` | Buyer | `createOrder` | Creates order from shop items/combos, supports fixed items, measured quantity, variants, delivery amount, and offers. Does not complete billing until seller completes order. |
| `GET` | `/orders/my?page=1&limit=20` | Buyer | `getMyOrders` | Lists current buyer orders. |
| `GET` | `/orders/seller?page=1&limit=20` | Seller | `getSellerOrders` | Lists active `NEW/PREPARING/READY` orders for seller shops. |
| `GET` | `/orders/seller/processed?page=1&limit=20` | Seller | `getSellerProcessedOrders` | Lists completed seller orders. |
| `GET` | `/orders/processed/all?page=1&limit=20&search=` | Admin | `getAllProcessedOrders` | Lists all completed orders, searchable by buyer name, phone, email, or order ID. |
| `GET` | `/orders/:orderId` | Buyer, owner seller, or admin | `getOrderDetails` | Returns full order detail, buyer/shop info, items, variants, measurements, commission, and completed order record. |
| `GET` | `/orders/:orderId/timeline` | Buyer, owner seller, or admin | `getOrderTimeline` | Returns timeline steps and current status. |
| `GET` | `/orders/:orderId/invoice` | Buyer, owner seller, or admin | `getOrderInvoice` | Returns invoice JSON for frontend PDF/print rendering. |
| `GET` | `/orders/:orderId/status` | Buyer, owner seller, or admin | `getOrderCurrentStatus` | Returns current status and completed status steps. |
| `PATCH` | `/orders/:orderId/payment-received` | Seller | `markPaymentReceived` | Marks payment received and updates paid amount for non-final seller order. |
| `PATCH` | `/orders/:orderId/confirm` | Seller | `confirmOrder` | Moves `NEW` order to `PREPARING` and decrements inventory atomically. |
| `PATCH` | `/orders/:orderId/ready` | Seller | `markOrderReady` | Moves `PREPARING` order to `READY`. |
| `PATCH` | `/orders/:orderId/complete` | Seller | `markOrderComplete` | Completes order, records paid amount, revenue summaries, buyer completed order, commission charge, and billing data. |
| `PATCH` | `/orders/:orderId/cancel` | Buyer, owner seller, or admin | `cancelOrder` | Cancels allowed non-final order and restores inventory if needed. |
| `PATCH` | `/orders/:orderId/refund` | Seller | `refundCompletedOrder` | Refunds paid completed order amount, updates commission adjustment and revenue deltas. |

## Ads Flow

All `/ads` routes require `verifyJWT`.

Main ad upload fields:

```txt
sellerDashboardImg
sellerHomeImg
buyerExploreImg
buyerShopPageImg
buyerAdImg
```

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/ads/create` | Authenticated, controller enforces admin style behavior | `createAd` | Creates placement ad with images, active window, target mode, and targeted sellers if provided. |
| `GET` | `/ads/seller?placement=` | Seller | `fetchSellerAds` | Fetches ads visible to seller dashboard/home placements. |
| `GET` | `/ads/buyer?placement=&shopId=` | Buyer | `fetchBuyerAds` | Fetches buyer placement ads, optionally scoped to a shop page. |
| `GET` | `/ads/buyer-ads` | Buyer | `fetchBuyerSideAds` | Fetches active buyer-side ads. |
| `POST` | `/ads/buyer-ads/admin` | Admin | `createBuyerAd` | Creates buyer-side ad with optional image and target settings. |
| `GET` | `/ads/buyer-ads/admin?page=1&limit=20` | Admin | `fetchAllBuyerAdsForAdmin` | Lists buyer-side ads for admin management. |
| `GET` | `/ads/buyer-ads/admin/:buyerAdId` | Admin | `fetchBuyerAdByIdForAdmin` | Gets one buyer-side ad. |
| `PATCH` | `/ads/buyer-ads/admin/:buyerAdId` | Admin | `updateBuyerAd` | Updates buyer-side ad metadata/image. |
| `DELETE` | `/ads/buyer-ads/admin/:buyerAdId` | Admin | `deleteBuyerAd` | Deletes buyer-side ad. |
| `PATCH` | `/ads/buyer-ads/admin/:buyerAdId/active` | Admin | `updateBuyerAdActiveStatus` | Activates/deactivates buyer-side ad. |
| `PATCH` | `/ads/:adId/active` | Admin | `updateAdActiveStatus` | Activates/deactivates placement ad. |
| `DELETE` | `/ads/:adId` | Admin | `deleteAd` | Deletes placement ad. |
| `GET` | `/ads/fetchAll?placement=&shopId=&everything=` | Authenticated | `fetchActiveAds` | Fetches active ads for placement, shop, or admin-style everything mode. |

## Tags Flow

All `/tags` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/tags/allTags` | Admin or seller | `fetchAllTags` | Lists all tags. |
| `GET` | `/tags/active` | Authenticated | `fetchActiveTags` | Lists active tags. |
| `POST` | `/tags/create` | Admin | `createTag` | Creates a tag with name, slug, and active flag. |
| `POST` | `/tags/items/:itemId` | Admin | `assignTagsToItem` | Assigns existing tags to a master item. |
| `DELETE` | `/tags/items/:itemId/:tagId` | Admin | `removeTagFromItem` | Removes one tag from a master item. |
| `POST` | `/tags/combos/:comboId` | Admin | `assignTagsToCombo` | Assigns existing tags to a combo. |
| `DELETE` | `/tags/combos/:comboId/:tagId` | Admin | `removeTagFromCombo` | Removes one tag from a combo. |
| `PATCH` | `/tags/:tagId/active` | Admin | `updateTagActiveStatus` | Activates/deactivates a tag. |
| `GET` | `/tags/:tagId` | Authenticated | `fetchTagById` | Gets one tag. |
| `PATCH` | `/tags/:tagId` | Admin | `updateTag` | Updates tag name/slug/active fields. |
| `DELETE` | `/tags/:tagId` | Admin | `deleteTag` | Deletes a tag. |

## Offers Flow

All `/offers` routes require `verifyJWT`.

Offer image field:

```txt
offerImg
```

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/offers/create` | Seller or admin by controller checks | `createOffer` | Creates offer rules for cart/items/combos, menus, audience, tags, buyers, dates, image, and stacking. |
| `GET` | `/offers/shop/:shopId/available` | Buyer | `fetchAvailableOffersByShop` | Returns buyer-eligible offers for a shop, including new-customer and audience checks. |
| `GET` | `/offers/shop/:shopId/buyers/search?query=` | Seller or admin by controller checks | `searchBuyersForOfferTarget` | Searches buyers for targeted offer assignment and returns shop order context. |
| `GET` | `/offers/shop/:shopId` | Seller/admin by controller checks | `fetchOffersByShop` | Lists offers for one shop. |
| `POST` | `/offers/:offerId/duplicate` | Seller owner or admin | `duplicateOffer` | Copies an offer and its menus/items/combos/buyers/tags into a new inactive offer. |
| `GET` | `/offers/:offerId/usage?page=1&limit=20` | Seller owner or admin | `fetchOfferUsage` | Returns estimated offer usage from completed discounted orders during the offer window. |
| `GET` | `/offers/:offerId/analytics` | Seller owner or admin | `fetchOfferAnalytics` | Returns estimated usage, discount, revenue totals, and daily trend for an offer window. |
| `PATCH` | `/offers/:offerId/active` | Seller owner or admin | `updateOfferActiveStatus` | Activates/deactivates an offer. |
| `GET` | `/offers/:offerId` | Authenticated | `fetchOfferById` | Gets one offer with related rules and targets. |
| `PATCH` | `/offers/:offerId` | Seller owner or admin | `updateOffer` | Updates offer metadata, dates, rules, target menus/items/combos/buyers/tags, and image. |
| `DELETE` | `/offers/:offerId` | Seller owner or admin | `deleteOffer` | Deletes an offer. |

## Revenue Flow

All `/revenue` routes require `verifyJWT`.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/revenue/shop/:shopId/repeat-customers?minOrders=2&startDate=&endDate=` | Seller owner or admin by controller checks | `fetchRepeatCustomersByShop` | Finds repeat customers for a shop from completed orders. |
| `GET` | `/revenue/shop/:shopId?periodType=DAILY&startDate=&endDate=` | Seller owner or admin by controller checks | `fetchShopRevenueStats` | Returns revenue summary and period rows for a shop. |

## Banners Flow

All `/banners` routes require `verifyJWT`.

Banner image fields:

```txt
bannerImg
image
```

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `POST` | `/banners/create` | Admin or seller | `createBanner` | Creates a banner for one seller shop or multiple admin-selected shops with image/text/link/active data. |
| `GET` | `/banners/shop/:shopId/published` | Authenticated | `fetchPublishedBannersByShop` | Returns active/published banners for buyer shop views. |
| `GET` | `/banners/shop/:shopId/manage` | Admin or seller | `fetchShopBannersForManage` | Returns banners for management UI. |
| `PATCH` | `/banners/:bannerId/publish` | Admin or seller | `updateBannerPublishStatus` | Publishes/unpublishes a banner. |
| `PATCH` | `/banners/:bannerId` | Admin or seller | `updateBanner` | Updates banner text/link/image/active data. |
| `DELETE` | `/banners/:bannerId` | Admin or seller | `deleteBanner` | Deletes a banner. |

## Billing Flow

All `/billing` routes require `verifyJWT`.

Recharge creation rules:

- Day-based recharge: send `dayOptionId`.
- Fixed-amount recharge: send `amountOptionId`.
- Do not send both.
- Seller creates request only; wallet/slot credit happens after admin approval.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/billing/config` | Authenticated | `getBillingConfig` | Returns billing settings, day recharge options, and amount recharge options. |
| `PATCH` | `/billing/config` | Admin | `updateBillingConfig` | Updates daily slot price, commission percent, estimation buffer, and billing config values. |
| `POST` | `/billing/day-options` | Admin | `createRechargeDayOption` | Creates a day-based recharge option. |
| `DELETE` | `/billing/day-options/:optionId` | Admin | `deleteRechargeDayOption` | Deletes a day-based recharge option. |
| `POST` | `/billing/amount-options` | Admin | `createRechargeAmountOption` | Creates a fixed-amount recharge option. |
| `DELETE` | `/billing/amount-options/:optionId` | Admin | `deleteRechargeAmountOption` | Deletes a fixed-amount recharge option. |
| `POST` | `/billing/recharges` | Seller | `createRechargeRequest` | Creates seller recharge request after checking shop access, requested slots, selected option, and payment transfer flag. |
| `GET` | `/billing/recharges?status=PENDING&page=1&limit=20` | Admin | `listRechargeRequests` | Lists recharge requests, optionally filtered by status. |
| `GET` | `/billing/recharges/my?shopId=&page=1&limit=20` | Seller | `listMyRechargeRequests` | Lists current seller recharge requests, optionally by shop. |
| `PATCH` | `/billing/recharges/:rechargeId/review` | Admin | `reviewRechargeRequest` | Approves/rejects recharge. Approval credits wallet/slots and writes billing ledger data. |
| `GET` | `/billing/shops/:shopId/summary?additionalSlots=0` | Seller owner or admin | `getShopBillingSummary` | Returns shop balance/slots/trial/recharge estimate summary. |
| `GET` | `/billing/shops/:shopId/revenue` | Admin | `getShopRevenueOverview` | Returns billing revenue overview for one shop. |
| `GET` | `/billing/shops/:shopId/ledger?page=1&limit=20` | Seller owner or admin | `getShopBillingLedger` | Returns shop billing ledger rows. |
| `POST` | `/billing/shops/:shopId/sync-slots` | Admin | `syncShopSlots` | Recalculates/synchronizes shop slot state and optionally grants missing slots. |
| `POST` | `/billing/settlements/run` | Admin | `runDailyBilling` | Runs daily billing settlement for supplied `date` or current date. |
| `GET` | `/billing/company-revenue?page=1&limit=30&from=&to=` | Admin | `getCompanyRevenue` | Returns company revenue rows and pagination. |

## Analytics Flow

All `/analytics` routes require `verifyJWT` and admin access.

| Method | Route | Access | Controller | Flow |
|---|---|---|---|---|
| `GET` | `/analytics/admin/summary` | Admin | `getAdminAnalyticsSummary` | Returns dashboard summary cards: sellers, buyers, orders, revenue, billing totals, repeat buyers. |
| `GET` | `/analytics/admin/trends?days=14&start=&end=` | Admin | `getAdminAnalyticsTrends` | Returns order and revenue trends for a date window. |
| `GET` | `/analytics/admin/top-shops?limit=10&sort=revenue` | Admin | `getAdminAnalyticsTopShops` | Returns top shops by completed revenue/orders depending on sort. |
| `GET` | `/analytics/admin/top-buyers?limit=10` | Admin | `getAdminAnalyticsTopBuyers` | Returns top buyers by completed order activity/revenue. |
| `GET` | `/analytics/admin/seller-wallet-monitor?page=1&limit=20&search=&lowBalanceOnly=false` | Admin | `getAdminSellerWalletMonitor` | Returns seller wallet, daily cost, days left, recharge status, and low-balance monitor rows. |

## End-To-End Frontend Flows

### Auth And Role Flow

1. Call `/auth/generateOTP`.
2. Call `/auth/verifyOTP`.
3. Store `data.accessToken` into `accessToken`.
4. Use the same header for all protected calls.
5. Route access depends on the role in the token.

### Admin Setup Flow

1. Create or verify users via `/users`, `/buyers/create/:userId`, `/sellers/create/:userId`.
2. Create shop types with `/shop-types`.
3. Create cuisines, categories, and master items.
4. Assign tags to master items/combos if needed.
5. Verify/start shops with `/shops/start/:shopId`.
6. Configure shop feature overrides with `/shop-types/shops/:shopId/features`.
7. Configure billing with `/billing/config`, `/billing/day-options`, and `/billing/amount-options`.
8. Monitor using `/analytics/admin/*`, `/users/admin/shops`, and `/orders/processed/all`.

### Seller Inventory Flow

1. Seller creates profile with `/sellers/create`.
2. Seller creates shop with `/shops/create`.
3. Seller sets timings/status/settings.
4. Seller adds shop inventory with `/items/custom`.
5. For fixed food items, send `pricing` and optional `variantGroups`.
6. For vegetable/weighted items, send `pricingMode: MEASURED`, `unit`, `pricePerUnit`, `quantityStep`, and `availableQuantityValue`.
7. Seller creates combos from `shopItemId`.
8. Seller creates menus from `shopItemId` and `comboId`.
9. Seller creates offers and banners.

### Buyer Browse And Checkout Flow

1. Buyer profile exists through `/buyers/create`.
2. Browse nearby shops with `/shops/nearby`.
3. Open shop with `/shops/find/:shopId` or `/shops/findshop/:slug`.
4. Fetch running menus with `/menus/shop/:shopId/running`.
5. Fetch available offers with `/offers/shop/:shopId/available`.
6. Checkout with `/orders/checkout`.
7. Track order with `/orders/my`, `/orders/:orderId/status`, `/orders/:orderId/timeline`, or `/orders/:orderId`.

### Order Execution Flow

1. Buyer calls `POST /orders/checkout`, order starts as `NEW`.
2. Seller sees it in `GET /orders/seller`.
3. Seller can mark payment received if needed.
4. Seller confirms order with `PATCH /orders/:orderId/confirm`, inventory is decremented.
5. Seller marks ready with `PATCH /orders/:orderId/ready`.
6. Seller completes with `PATCH /orders/:orderId/complete`, revenue and commission records are written.
7. Admin sees completed order in `GET /orders/processed/all`.

### Billing Recharge Flow

1. Admin creates recharge options.
2. Seller checks `/billing/config` and `/billing/shops/:shopId/summary`.
3. Seller creates `/billing/recharges` with `dayOptionId` or `amountOptionId`.
4. Admin lists `/billing/recharges`.
5. Admin reviews `/billing/recharges/:rechargeId/review`.
6. Seller/admin reads `/billing/shops/:shopId/ledger`.

## Coverage Note

This guide intentionally lists active mounted routes only. Commented-out routes
in route files, older recharge code inside `shop.controller.js`, and Postman
example-only convenience requests are not active API surfaces.
