-- The Faktur URL, invoice path and environment are the same for every clinic: the API reads them
-- from FAKTUR_API_URL, FAKTUR_INVOICE_PATH and FAKTUR_ENVIRONMENT. Each clinic keeps its own key,
-- establishment, emission point and numbering.
ALTER TABLE "BillingSettings" DROP COLUMN "apiUrl",
DROP COLUMN "environment",
DROP COLUMN "invoicePath";
