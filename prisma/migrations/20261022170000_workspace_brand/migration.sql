-- Onboarding quiz fields; the "" userId row now holds the workspace brand.
ALTER TABLE "BrandProfile" ADD COLUMN "locations" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "serviceAreas" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "phone" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "email" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "address" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "products" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "priceBand" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "offers" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "usps" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "competitors" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "keywords" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "hashtags" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "palette" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "fonts" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "socialLinks" TEXT;
ALTER TABLE "BrandProfile" ADD COLUMN "seasonality" TEXT;
