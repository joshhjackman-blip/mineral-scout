SET statement_timeout = 0;

WITH scored AS (
  SELECT
    id,
    LEAST(
      10,
      (
        -- ══════════════════════════════════════════
        -- LOCATION SIGNALS (max 4 pts)
        -- ══════════════════════════════════════════
        CASE
          WHEN mailing_state NOT IN ('TX', 'Texas')
          AND mailing_state IS NOT NULL
          AND mailing_state != ''
          THEN 3 ELSE 0
        END +
        CASE
          WHEN UPPER(COALESCE(mailing_address, '')) LIKE '%P.O.%'
          OR UPPER(COALESCE(mailing_address, '')) LIKE '%PO BOX%'
          THEN 1 ELSE 0
        END +

        -- ══════════════════════════════════════════
        -- OWNER TYPE SIGNALS (max 4 pts)
        -- ══════════════════════════════════════════
        CASE WHEN UPPER(owner_name) LIKE '%ESTATE%' THEN 4 ELSE 0 END +
        CASE WHEN UPPER(owner_name) LIKE '%IRREVOCABLE%' THEN 3 ELSE 0 END +
        CASE
          WHEN UPPER(owner_name) LIKE '%LIVING TRUST%'
          OR UPPER(owner_name) LIKE '%LIV TR%'
          THEN 2 ELSE 0
        END +
        CASE
          WHEN UPPER(owner_name) LIKE '%TRUST%'
          AND UPPER(owner_name) NOT LIKE '%LIVING TRUST%'
          AND UPPER(owner_name) NOT LIKE '%IRREVOCABLE%'
          THEN 1 ELSE 0
        END +
        CASE
          WHEN UPPER(owner_name) LIKE '%LIFE ESTATE%'
          OR UPPER(owner_name) LIKE '%LIFE EST%'
          THEN 3 ELSE 0
        END +
        CASE
          WHEN (UPPER(owner_name) LIKE '%LLC%'
            OR UPPER(owner_name) LIKE '%L.L.C%'
            OR UPPER(owner_name) LIKE '%LP%'
            OR UPPER(owner_name) LIKE '% L.P.%')
          AND mailing_state NOT IN ('TX', 'Texas')
          THEN 2 ELSE 0
        END +
        CASE
          WHEN (UPPER(owner_name) LIKE '%LLC%'
            OR UPPER(owner_name) LIKE '%LP%')
          AND mailing_state IN ('TX', 'Texas')
          THEN 1 ELSE 0
        END +

        -- ══════════════════════════════════════════
        -- ASSET SIZE SIGNALS (max 3 pts)
        -- ══════════════════════════════════════════
        CASE
          WHEN acreage IS NOT NULL AND acreage < 5 THEN 3
          WHEN acreage IS NOT NULL AND acreage < 15 THEN 2
          WHEN acreage IS NOT NULL AND acreage < 40 THEN 1
          ELSE 0
        END +

        -- ══════════════════════════════════════════
        -- PRODUCTION SIGNALS (max 4 pts)
        -- ══════════════════════════════════════════
        CASE WHEN prod_cumulative_sum_oil > 5000 THEN 1 ELSE 0 END +
        CASE
          WHEN first_6_month_oil > 0
          AND first_60_month_oil > 0
          AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil, 0)) > 2.5
          THEN 3
          WHEN first_6_month_oil > 0
          AND first_60_month_oil > 0
          AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil, 0)) > 1.8
          THEN 2
          WHEN first_6_month_oil > 0
          AND first_60_month_oil > 0
          AND (first_6_month_oil::numeric / NULLIF(first_60_month_oil, 0)) > 1.3
          THEN 1
          ELSE 0
        END +
        CASE
          WHEN COALESCE(NULLIF(raw_record->>'Value Appraised', ''), '0')::numeric < 5000
          AND COALESCE(NULLIF(raw_record->>'Value Appraised', ''), '0')::numeric > 0
          THEN 2
          WHEN COALESCE(NULLIF(raw_record->>'Value Appraised', ''), '0')::numeric < 15000
          AND COALESCE(NULLIF(raw_record->>'Value Appraised', ''), '0')::numeric > 0
          THEN 1
          ELSE 0
        END +
        CASE
          WHEN COALESCE(NULLIF(raw_record->>'Interest', ''), '0')::numeric < 0.001
          AND COALESCE(NULLIF(raw_record->>'Interest', ''), '0')::numeric > 0
          THEN 2
          WHEN COALESCE(NULLIF(raw_record->>'Interest', ''), '0')::numeric < 0.005
          THEN 1
          ELSE 0
        END
      )
    ) AS score
  FROM gonzales_mineral_ownership
)
UPDATE gonzales_mineral_ownership g
SET
  propensity_score = scored.score,
  motivated = (scored.score >= 6)
FROM scored
WHERE g.id = scored.id;

-- Print distribution
SELECT propensity_score, COUNT(*) as count
FROM gonzales_mineral_ownership
GROUP BY propensity_score
ORDER BY propensity_score DESC;
