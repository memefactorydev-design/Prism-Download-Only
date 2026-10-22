# SKILLS: Magnus — GBP Domination Playbook

## 1. Category selection
1. **Primary category** (the biggest single ranking lever): choose the Google category that most precisely describes the core product or service in the brief's Overview — then test it by checking, via live search, which category the current top-3 local-pack results use for "[primary service] [each location in the brief]"; match the winning pattern.
2. **Secondary categories**: add all genuinely applicable ones for the other products & services in the brief. Never add categories for services not offered (policy risk, relevance dilution).
3. Re-audit quarterly: Google adds categories regularly; competitors' category choices are visible via Maps listing details or auditing tools — log them in the competitor sheet.

## 2. Services & business description
1. Under each category, add named services — one per product or service line in the brief's Overview, plus the conversion offer from its Goals (a free consultation, quote or trial if the brief has one). Each description (≤300 chars): what it is + a natural keyword + a differentiator drawn from Positioning & USPs.
2. Business description (750 chars): lead with the primary product/service + location + the brand's positioning + an invitation to take the Goals' conversion action in the first sentence or two. No URLs, no offer spam (policy).
3. Attributes: set everything applicable (wheelchair access, appointments, on-site services, delivery, LGBTQ-friendly etc. as accurate). Add booking/appointment link pointing to the conversion page (UTM-tagged, §9).

## 3. Photos & video — cadence and what actually matters
1. **Cadence**: minimum 3 new photos per location per week; 1 video (a premises walkthrough if the brief lists a location, a work time-lapse, a team intro) per month. Fresh uploads signal an active business and feed Maps/AI surfaces.
2. **What to upload**: finished-work hero shots, detail close-ups, the premises (if the brief lists one), team at work, before/after pairs, products in use. Name files descriptively before upload ("[product]-[descriptor]-[town].jpg").
3. **Geotagging myth, handled honestly**: embedding GPS EXIF data into image files is widely sold as a ranking tactic; there is no solid evidence Google uses image EXIF for local ranking, and Google strips much metadata. Do not spend effort on EXIF geotagging. What *actually* matters: real, high-quality, recent photos; uploading consistently; photos that earn views and keep users on the listing; accurate categorisation of interior/exterior shots.
4. Audit quarterly: remove outdated premises shots; check user-uploaded photos and flag any inappropriate ones.

## 4. Google Posts — weekly engine
1. **Rotation (one post per location per week)**:
   - Week 1 — **Offer**: a current promotion from the brief's Positioning & USPs — quote only what's there, never invent one; finance posts flagged for compliance review first. Include start/end dates and terms. Use Offer post type so it gets the coupon treatment. No live offer? Run a second showcase instead.
   - Week 2 — **Update/Showcase**: a completed job, product or customer result local to that location with 2–3 photos ("A [product] for a customer in [nearby town]…").
   - Week 3 — **Update/Educational**: a tip, a material or method spotlight, link to Otto's relevant guide.
   - Week 4 — **Event or seasonal**: an event at the location, a launch, a seasonal CTA tied to the brief's Seasonality.
2. Format: 150–300 characters of substance first (Google truncates), one CTA button (Book / Learn more / Call now / Order), UTM-tagged link, real photo.
3. Localise: each location in the brief gets different examples — never identical duplicate posts (looks automated, performs worse).

## 5. Review generation system
1. **Ask at emotional high points**: (a) the moment the customer first sees the plan, design or product, (b) completion/handover/delivery day, (c) after any experience or event the brief offers, (d) 2–4 weeks later, "how are you getting on" call. Completion day is the single best moment — brief whoever is with the customer at that point to make the ask personally.
2. **Make it frictionless**: short review link (g.page link) per location; QR code on handover packs, packaging, receipts, counter cards and aftercare emails that opens the review form directly. Ensure the right location's link goes to the right customer.
3. **The ask script** (for the team): "It would mean a great deal if you'd share a few words about your experience — especially what you think of [specific feature]. Here's a card with a QR code, it takes two minutes." Mentioning a specific feature prompts keyword-rich reviews naturally — never script the review itself.
4. **Compliance**: no incentives, no gating, no bulk-asks from old lists without lawful basis. Ask every customer, not just the delighted ones.
5. **Respond to 100% of reviews within 48 hours**:
   - Positive: thank by name, reference a specific detail they mentioned, naturally include a service/area term once, invite them back. Vary structure — no templates verbatim.
   - Negative: acknowledge, apologise where warranted, never argue or reveal personal/job details, give a named contact and the phone number from the brief, take it offline. Escalate legal/safety/refund issues to humans before replying substantively.
6. Track velocity monthly per location; if a location stalls, audit which team touchpoint stopped asking.

## 6. Q&A seeding and management
1. Seed each profile with 6–10 real prospect questions (asked from the business, answered from the business — this is permitted and best practice): "Do you offer [the conversion offer in the brief's Goals]?", "What price range do you start at?" (answer from the brief's price band), "Do you cover [each service area in the brief]?", "Is parking available?" (if there's a location), "Do you offer finance?" (compliant answer, only if the brief says so), "Do you also do [secondary service]?".
2. Answers: concise, factual, one natural keyword, CTA where apt.
3. Check daily for new public questions — anyone can answer Q&A, so an unanswered question invites wrong answers. Upvote the official answer so it ranks first.

## 7. Local pack ranking factors — working the levers
1. **Relevance**: nailed categories (§1), complete services (§2), keyword-natural description, posts and reviews that mention services. Otto's matching location pages (linked as the website URL per location) reinforce relevance.
2. **Distance**: can't move the premises — so win the radius you have. Local landing pages and area-mention reviews extend perceived service area; the service-area setting should list every town in the brief's Locations & service areas.
3. **Prominence**: review count + rating + velocity, photo engagement, citations consistency (NAP identical everywhere — coordinate with Otto's directory work), links to the location pages, branded-search volume (boosted by Scout's ads). Prominence is the long game; review velocity is your strongest controllable input.
4. Benchmark monthly against the top 3 in each pack for priority terms: their review count/rating, primary category, post recency. Close the gaps deliberately. Any ranking-factor claims you make are indicative — Google publishes only the three broad factors.

## 8. Spam fighting & profile defence
1. Monthly sweep of local-pack results for priority terms; flag listings with: keyword-stuffed business names, fake/virtual addresses, duplicate listings of one business, review surges of suspicious accounts.
2. Report genuine violations via "Suggest an edit" / the Business Redressal Complaint Form with evidence (screenshots, Street View of the fake address, company-register mismatch). Log every report and outcome. Never file frivolous or anti-competitive reports.
3. **Defence**: check the profiles daily for unapproved "suggested edits" (hours, phone, website changes) and revert immediately; keep ownership/manager access restricted and documented; watch for duplicate listings of the brand and request merges.

## 9. UTM tagging for GBP links
Tag every link so GBP traffic is visible in GA4 (Google reports much of it as direct/organic otherwise):
- Website link: `?utm_source=google&utm_medium=organic&utm_campaign=gbp-<location-slug>` (one slug per location in the brief)
- Appointment link: `utm_campaign=gbp-<location-slug>&utm_content=booking`
- Posts: `utm_content=post-offer-<mmmyy>` style, per post.
Keep a tagging register so naming stays consistent; coordinate conventions with Otto and Scout.

## 10. Monthly reporting
Per location, report: search vs maps impressions, top search queries, calls, direction requests, website clicks (cross-checked against UTM data in GA4), bookings, new reviews + rating trend + response rate, posts published, photos added and their views vs competitor baseline where available, Q&A activity, spam reports filed/resolved, local-pack positions on 5 priority terms (spot-checked via live search from neutral context — note that personalisation/location makes these indicative). Close with: three wins, one concern, top three actions for next month. Numbers come only from the GBP dashboard, GA4 and logged checks — never estimated and presented as actuals.
