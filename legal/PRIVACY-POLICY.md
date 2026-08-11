# Mineral Map — Privacy Policy

**Version:** `2026-08-11`
**Effective date:** August 11, 2026
**Applies to:** `getmineralmap.com` and related Mineral Map services

> ⚠️ **This is a first-pass template drafted by the platform team, not by
> counsel.** Have a privacy attorney review before relying on it for
> regulatory compliance (including CCPA/CPRA or other state privacy laws
> that may apply to your customers or data subjects).

---

## 1. Who we are

**Brentwood Enterprises LLC**, a Texas limited liability company doing
business as **Mineral Map** ("**Mineral Map**," "**we**," "**us**," or
"**our**"), operates the Mineral Map platform.

**Contact for privacy requests:**
`josh@brentwoodenterprisesllc.com`  
**Business contact:** `management@mineralmapllc.com`

## 2. Scope

This Privacy Policy describes how we collect, use, share, and retain
information when you:

- visit our marketing site;
- create an account or use the Mineral Map platform (map, CRM, permits,
  pad activity, document tools, and related features); or
- communicate with us (demo requests, support tickets, email).

Our [Platform Services Agreement](/legal/agreement) and
[Terms of Use](/legal/terms) govern access to the paid platform. If
there is a conflict about platform use between those documents and this
Policy, the Agreement / Terms control for contractual rights; this
Policy describes our privacy practices.

## 3. Information we collect

### 3.1 Account and profile
- Email address, name, and authentication identifiers (via Supabase Auth)
- Organization / team membership and seat role
- Billing-related identifiers (Stripe customer / subscription IDs; we do
  not store full card numbers)
- Agreement signature records (typed name, email, entity/title, IP,
  user agent, timestamp, agreement version)

### 3.2 Platform usage
- Map interactions, tract/owner views, CRM notes and deal records you
  create, watchlists, and similar workspace content
- Feature usage metrics (for example skip-trace call counts per month)
  for billing, abuse prevention, and product improvement
- Support tickets and demo-booking submissions you send us

### 3.3 Mineral / public-record style data
The Platform surfaces mineral ownership, parcel, well, permit, and
related records compiled from public or licensed sources. That content
is part of the product dataset, not information you voluntarily
"submit" as a consumer form — but your **queries and exports** of it
are associated with your account.

### 3.4 Skip-trace and contact enrichment
When you run a skip-trace (or a similar enrichment) through the
Platform, we may send owner identifiers (such as name and mailing
address) to third-party data providers and receive phone numbers and
email addresses in return. Results may be stored in a **shared cache**
so that a later lookup for the same owner by any customer can be
served without re-querying the provider. Cache entries are keyed on a
normalized owner name and are not labeled with your company name in
the shared store.

> Skip-trace provider integrations and TCPA / DNC hygiene controls are
> being rolled out separately. Until those controls are live, treat
> enriched contact data with care and follow your own compliance
> program before calling or texting any number.

### 3.5 Technical data
- IP address, browser user agent, approximate request metadata
- Cookies and similar technologies needed for authentication and
  session security
- Optional product analytics (e.g. PostHog) if configured for your
  deployment

### 3.6 Payment data
Payments are processed by **Stripe**. Stripe collects and processes
payment method details under its own privacy policy. We receive
limited billing metadata (status, seat quantity, metered usage
references).

## 4. How we use information

We use information to:

- provide, secure, and improve the Platform;
- authenticate users and enforce seats, billing, and agreement gates;
- process subscriptions and metered usage;
- prevent abuse, fraud, and unauthorized access;
- respond to support and demo requests;
- comply with law and enforce our agreements; and
- (with analytics tools, if enabled) understand aggregate product usage.

We do **not** sell personal information for money. We do not allow
third parties to use Platform contact data for their own independent
marketing.

## 5. How we share information

We share information only as needed with:

- **Service providers** that host or operate the Platform on our
  behalf (for example Supabase for database/auth/storage, Vercel for
  application hosting, Stripe for payments, Resend for transactional
  email, and skip-trace / enrichment vendors when that feature is
  enabled);
- **Other customers**, only indirectly via the shared skip-trace
  cache described above (enriched phones/emails for a normalized owner
  name — not your CRM notes or deal pipeline);
- **Professional advisers** or authorities when required by law or to
  protect rights, safety, and security; and
- a **successor** in connection with a merger, acquisition, or sale of
  assets, subject to this Policy or a successor policy with notice.

Team workspaces are isolated for CRM-style data (deals, notes, owner
overrides). Platform dataset and shared skip-trace cache behavior are
described above and in the Platform Services Agreement.

## 6. Cookies and sessions

We use cookies and local storage primarily for **authentication and
session continuity**. Without them, you cannot stay signed in. We do
not use advertising cookies on the product application. If we enable
product analytics, that tool may set its own cookies; you can request
details at the privacy contact above.

## 7. Retention

We retain account, billing, signature, and workspace data for as long
as your account is active and as needed for legitimate business,
legal, and audit purposes (including fee and attribution obligations
under the Platform Services Agreement). Skip-trace cache entries may
persist so later lookups can avoid re-billing a provider call. You
may request deletion of your account data as described below; some
records may be retained where we have a legal or contractual need to
keep them.

## 8. Security

We use industry-standard safeguards appropriate to a B2B SaaS product
(encryption in transit, access-controlled databases, service-role keys
kept server-side, and authentication on product APIs). No method of
transmission or storage is 100% secure.

## 9. Your choices and rights

Depending on your location and role, you may have rights to:

- access or correct account profile information;
- request export or deletion of personal data we hold about you as a
  user;
- close your account; and
- object to or restrict certain processing where applicable law
  provides that right.

**Workspace content** (CRM notes, deals) belongs to the customer
organization that created it; deletion requests from individual seats
may require the team admin. To make a request, email
`josh@brentwoodenterprisesllc.com` from your account email.

If you are a mineral owner or other individual whose contact data
appears because of public records or enrichment, contact us at the
same address. We will review and, where appropriate, suppress or
correct records we control.

## 10. Children

The Platform is a business service for mineral acquisition
professionals. It is not directed to children under 16, and we do not
knowingly collect personal information from children.

## 11. International users

We operate primarily in the United States. If you access the Platform
from elsewhere, you understand information may be processed in the
U.S. and other countries where our providers operate.

## 12. Changes

We may update this Policy by posting a new version at
`/legal/privacy` and updating the Version / Effective date. Material
changes will be highlighted in the product or by email when
appropriate. Continued use after the effective date constitutes
acceptance of the updated Policy.

## 13. Contact

Privacy questions and requests: `josh@brentwoodenterprisesllc.com`  
General / management: `management@mineralmapllc.com`
