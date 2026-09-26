-- Supplementary knowledge doc per business, on top of the Week 1 training
-- content call reviews are already graded against (services/callReviews.js)
-- -- management can paste in anything extra (a full feature list, FAQ,
-- pricing detail, objection playbook) and it gets included in every
-- grading call. Purely additive.
--
--   mysql -u USER -p DBNAME < db/migrations/013_company_knowledge.sql

CREATE TABLE IF NOT EXISTS company_knowledge (
  company ENUM('dashspid', 'nowagieops') PRIMARY KEY,
  content LONGTEXT,
  updated_at DATETIME NOT NULL
);
