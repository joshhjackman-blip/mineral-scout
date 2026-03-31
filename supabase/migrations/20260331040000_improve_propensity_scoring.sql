-- Reset all scores
UPDATE gonzales_mineral_ownership SET propensity_score = 0;

UPDATE gonzales_mineral_ownership
SET propensity_score = LEAST(10, (

  -- LOCATION (max 4 pts)
  CASE WHEN mailing_state NOT IN ('TX','Texas')
    AND mailing_state IS NOT NULL AND mailing_state != ''
    THEN 3 ELSE 0 END +
  CASE WHEN UPPER(COALESCE(mailing_address,'')) LIKE '%P.O.%'
    OR UPPER(COALESCE(mailing_address,'')) LIKE '%PO BOX%'
    THEN 1 ELSE 0 END +

  -- OWNER TYPE (max 4 pts)
  CASE WHEN UPPER(owner_name) LIKE '%ESTATE%' THEN 4
       WHEN UPPER(owner_name) LIKE '%LIFE ESTATE%' THEN 4
       ELSE 0 END +
  CASE WHEN UPPER(owner_name) LIKE '%IRREVOCABLE%' THEN 3 ELSE 0 END +
  CASE WHEN UPPER(owner_name) LIKE '%LIVING TRUST%' THEN 2 ELSE 0 END +
  CASE WHEN UPPER(owner_name) LIKE '%TRUST%'
    AND UPPER(owner_name) NOT LIKE '%LIVING TRUST%'
    AND UPPER(owner_name) NOT LIKE '%IRREVOCABLE%'
    THEN 1 ELSE 0 END +
  CASE WHEN (UPPER(owner_name) LIKE '%LLC%' OR UPPER(owner_name) LIKE '%LP%')
    AND mailing_state NOT IN ('TX','Texas') THEN 2
    WHEN (UPPER(owner_name) LIKE '%LLC%' OR UPPER(owner_name) LIKE '%LP%')
    THEN 1 ELSE 0 END +

  -- ASSET SIZE (max 3 pts)
  CASE WHEN acreage IS NOT NULL AND acreage < 5 THEN 3
       WHEN acreage IS NOT NULL AND acreage < 15 THEN 2
       WHEN acreage IS NOT NULL AND acreage < 40 THEN 1
       ELSE 0 END +

  -- PRODUCTION DECLINE (max 3 pts)
  CASE WHEN first_6_month_oil > 0 AND first_60_month_oil > 0
    AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil,0)) > 2.5 THEN 3
    WHEN first_6_month_oil > 0 AND first_60_month_oil > 0
    AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil,0)) > 1.8 THEN 2
    WHEN first_6_month_oil > 0 AND first_60_month_oil > 0
    AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil,0)) > 1.3 THEN 1
    ELSE 0 END +

  -- APPRAISED VALUE (max 2 pts)
  CASE WHEN (raw_record->>'Value Appraised')::numeric < 5000
    AND (raw_record->>'Value Appraised')::numeric > 0 THEN 2
    WHEN (raw_record->>'Value Appraised')::numeric < 15000
    AND (raw_record->>'Value Appraised')::numeric > 0 THEN 1
    ELSE 0 END +

  -- INTEREST SIZE (max 2 pts)
  CASE WHEN (raw_record->>'Interest')::numeric < 0.001
    AND (raw_record->>'Interest')::numeric > 0 THEN 2
    WHEN (raw_record->>'Interest')::numeric < 0.005 THEN 1
    ELSE 0 END +

  -- NEW PERMIT ACTIVITY (max 2 pts)
  -- Owner lease is in an area with recent drilling permit = hot zone
  CASE WHEN EXISTS (
    SELECT 1 FROM gonzales_permits p
    WHERE TRIM(LEADING '0' FROM p.api_number::text) =
          TRIM(LEADING '0' FROM gonzales_mineral_ownership.rrc_lease_id::text)
  ) THEN 2 ELSE 0 END

));

-- Update motivated flag — raise threshold to 6
UPDATE gonzales_mineral_ownership
SET motivated = (propensity_score >= 6);

-- Print distribution
SELECT propensity_score, COUNT(*) as count
FROM gonzales_mineral_ownership
GROUP BY propensity_score
ORDER BY propensity_score DESC;
