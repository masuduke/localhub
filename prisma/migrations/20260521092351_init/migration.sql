-- CreateEnum
CREATE TYPE "Country" AS ENUM ('uk', 'bd');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer', 'vendor', 'driver', 'job_seeker', 'admin');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'accepted', 'ready', 'dispatched', 'delivered', 'rejected', 'refunded');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('ecommerce', 'grocery', 'food');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('pending', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('pending', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "PromoStatus" AS ENUM ('pending', 'active', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'cash', 'bkash', 'nagad', 'apple_pay', 'google_pay');

-- CreateEnum
CREATE TYPE "NotifType" AS ENUM ('order', 'payment', 'review', 'stock', 'job', 'promo', 'system', 'referral');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('bronze', 'silver', 'gold', 'platinum');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'customer',
    "country" "Country" NOT NULL,
    "avatar" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "loyaltyCredits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loyaltyTier" "LoyaltyTier" NOT NULL DEFAULT 'bronze',
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "referralCreditEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobCategoryIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "country" "Country" NOT NULL,
    "type" "VendorType" NOT NULL,
    "status" "VendorStatus" NOT NULL DEFAULT 'pending',
    "logoEmoji" TEXT,
    "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionOwed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "vehicle" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'pending',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "badge" TEXT,
    "pricingBase" DOUBLE PRECISION NOT NULL DEFAULT 1.50,
    "pricingPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0.60,
    "pricingMin" DOUBLE PRECISION NOT NULL DEFAULT 2.50,
    "pricingMaxDist" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastSeen" TIMESTAMP(3),

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverEarning" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "weekLabel" TEXT NOT NULL,
    "gross" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "net" DOUBLE PRECISION NOT NULL,
    "trips" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "emoji" TEXT,
    "color" TEXT,
    "category" TEXT NOT NULL,
    "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stock" INTEGER NOT NULL DEFAULT 0,
    "totalSales" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vendorId" TEXT,
    "driverId" TEXT,
    "country" "Country" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformFee" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "payment" "PaymentMethod" NOT NULL,
    "paymentRef" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "addressCity" TEXT,
    "addressPostcode" TEXT,
    "addressLat" DOUBLE PRECISION,
    "addressLng" DOUBLE PRECISION,
    "pickupAddress" TEXT,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "distanceMiles" DOUBLE PRECISION,
    "promoId" TEXT,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "emoji" TEXT,
    "from" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "salary" TEXT NOT NULL,
    "minExp" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "postedById" TEXT,
    "weeklyRate" DOUBLE PRECISION NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "coverLetter" TEXT,
    "cvUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "type" "PromoType" NOT NULL,
    "minOrder" DOUBLE PRECISION NOT NULL,
    "category" TEXT,
    "emoji" TEXT,
    "color" TEXT,
    "status" "PromoStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT,
    "vendorId" TEXT,
    "driverId" TEXT,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "status" "ChatStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotifType" NOT NULL,
    "icon" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_country_idx" ON "User"("country");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_referralCode_idx" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_userId_key" ON "Vendor"("userId");

-- CreateIndex
CREATE INDEX "Vendor_country_idx" ON "Vendor"("country");

-- CreateIndex
CREATE INDEX "Vendor_type_idx" ON "Vendor"("type");

-- CreateIndex
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE INDEX "Driver_country_idx" ON "Driver"("country");

-- CreateIndex
CREATE INDEX "Driver_status_idx" ON "Driver"("status");

-- CreateIndex
CREATE INDEX "Driver_isOnline_idx" ON "Driver"("isOnline");

-- CreateIndex
CREATE INDEX "DriverEarning_driverId_idx" ON "DriverEarning"("driverId");

-- CreateIndex
CREATE INDEX "Product_vendorId_idx" ON "Product"("vendorId");

-- CreateIndex
CREATE INDEX "Product_country_idx" ON "Product"("country");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_vendorId_idx" ON "Order"("vendorId");

-- CreateIndex
CREATE INDEX "Order_driverId_idx" ON "Order"("driverId");

-- CreateIndex
CREATE INDEX "Order_country_idx" ON "Order"("country");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCategory_name_key" ON "JobCategory"("name");

-- CreateIndex
CREATE INDEX "Job_country_idx" ON "Job"("country");

-- CreateIndex
CREATE INDEX "Job_categoryId_idx" ON "Job"("categoryId");

-- CreateIndex
CREATE INDEX "Job_isActive_idx" ON "Job"("isActive");

-- CreateIndex
CREATE INDEX "JobApplication_jobId_idx" ON "JobApplication"("jobId");

-- CreateIndex
CREATE INDEX "JobApplication_applicantId_idx" ON "JobApplication"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobId_applicantId_key" ON "JobApplication"("jobId", "applicantId");

-- CreateIndex
CREATE INDEX "Promo_country_idx" ON "Promo"("country");

-- CreateIndex
CREATE INDEX "Promo_status_idx" ON "Promo"("status");

-- CreateIndex
CREATE INDEX "Promo_vendorId_idx" ON "Promo"("vendorId");

-- CreateIndex
CREATE INDEX "Review_authorId_idx" ON "Review"("authorId");

-- CreateIndex
CREATE INDEX "Review_productId_idx" ON "Review"("productId");

-- CreateIndex
CREATE INDEX "Review_driverId_idx" ON "Review"("driverId");

-- CreateIndex
CREATE INDEX "Review_vendorId_idx" ON "Review"("vendorId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "PointsTransaction_userId_idx" ON "PointsTransaction"("userId");

-- CreateIndex
CREATE INDEX "PointsTransaction_createdAt_idx" ON "PointsTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfig_key_key" ON "PlatformConfig"("key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "JobCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
