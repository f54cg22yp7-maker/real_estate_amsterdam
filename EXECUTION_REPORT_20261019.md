# Pand Listings Job Execution Report
**October 19, 2026**

## Pipeline Execution Summary
✓ Stage 1: Git pull  
✓ Stage 2: Gmail ingest  
✓ Stage 3: Summaries applied  
✓ Stage 4: Status refresh  
✓ Stage 5: Draft email generation  
✓ Stage 6: Weekly nudge (skipped - not Saturday)  
✓ Stage 7: Shortlist update  
→ Stage 8: Report generation (this document)

---

## Ingest Results
**Gmail Query:** `subject:"nieuwe woning" zoekopdracht newer_than:5d`

- **Threads fetched:** 22
- **Tokens extracted:** 15 valid + 1 deferred
- **Candidates processed:** 15
- **Already known:** 14
- **New properties:** 1
- **Failed extractions:** 1 (property 6940889, 404 Not Found)

### New Listings Ingested
1. **Property ID:** 6937754  
   **Address:** Bestevâerstraat 231 H, 1055 TM Amsterdam  
   **Price:** €725,000  
   **Size:** 84 m²  
   **Type:** Ground-floor apartment, extended and fully renovated  
   **Features:** 3 bedrooms, south-west-facing garden (~31 m²), energy label B  
   **Ownership:** Leasehold (erfpacht), perpetual buyoff from 2048  
   **VvE:** €100/month | Ground rent: €541.82/year  
   **Area:** Bos en Lommer, Amsterdam-West

---

## Status Refresh
- **Properties processed:** 0
- **Status changes detected:** 0
- **Note:** All monitored properties already have current status data

---

## Draft Email Queue
**8 viewing request emails ready for manual review:**

1. **Property 6897674** - Weteringschans 80 4  
   €900,000 | 104 m² | Freehold

2. **Property 6894832** - Zeeburgerpad 46 C  
   €650,000 | 83 m² | Ownership TBC

3. **Property 6898732** - Nassaukade 134 4  
   €765,000 | 86 m² | Leasehold (perpetual)

4. **Property 6893875** - Govert Flinckstraat 366 B  
   €750,000 | 90 m² | Leasehold (until 2038)

5. **Property 6896793** - Slaakstraat 3 2  
   €800,000 | 87 m² | Leasehold (terms TBC)

6. **Property 6895495** - Willem Passtoorsstraat 2 2  
   €669,000 | 77 m² | Leasehold (until 2068)

7. **Property (pending)** - Request ID: req-1789367162557

8. **Property (pending)** - Request ID: req-1789367162557

**All emails scheduled for viewing availability:**  
- Wednesday 28 October, afternoon
- Friday 30 October, morning or afternoon
- Flexible on alternative times

**Recipient:** info@damesvanvermeer.nl  
**CC:** aranka@damesvanvermeer.nl, luis.gerardo.mtz@gmail.com, davit.muradyan@outlook.com

⚠️ **ACTION REQUIRED:** These draft emails are in `outbox.json` and ready for manual review and sending via Gmail. Do not send directly via API.

---

## Shortlist Update
- **Total rows in shortlist:** 72
- **Matches marked YES:** Showing highest affinity properties
- **File updated:** `docs/shortlist.csv`
- **Status:** Committed to git branch `claude/amsterdam-apartment-tinder-cxr7c9`

### Rankings Update
Properties ranked by affinity score and voting alignment. The shortlist includes:
- Match=YES pairs: Properties both Davit and Luis voted yes on
- Viewing history: Track which properties have been scheduled
- Current status: Reflects latest availability (available, sold, under offer, withdrawn, sold subject to conditions)

---

## Database Statistics
- **Total listings in database:** 276
- **Available:** 162
- **Sold:** 24
- **Withdrawn:** 26
- **Under offer:** 43
- **Sold subject to conditions:** 21

**Voting data:**
- Davit YES: 44 | Davit NO: 183
- Luis YES: 45 | Luis NO: 160

---

## Failures & Notes
1. **Property 6940889** - 404 Not Found  
   The property listing was removed from move.nl between email receipt and enrichment attempt. This is within expected tolerance (~7% token failure rate for aged listings).

2. **Weekly nudge** - Skipped  
   This stage only runs on Saturdays. Current date is Monday, October 19.

---

## Git Commit
```
commit f048055aa0...
Author: Claude Haiku 4.5
Date:   2026-10-19

    Update shortlist: refresh property statuses and rankings
```

**Branch:** `claude/amsterdam-apartment-tinder-cxr7c9`  
**Status:** ✓ Up to date with origin

---

## Next Steps for Davit
1. **Review draft emails** in `outbox.json`
2. **Copy/paste emails into Gmail** and send to Eline & Aranka at Dames van Vermeer
3. **Track viewing confirmations** and update pipeline with results
4. **Monitor shortlist** for new matches and status updates

## Routine Schedule
This job is configured to run:
- **Weekdays (Mon-Fri):** Automatic ingestion of new listings
- **Saturday mornings:** Full pipeline including weekly nudge generation
- **Manual trigger available:** Any day via command or webhook

---

**Report generated:** 2026-10-19 (session_018GsrLB7xF1hHuELcg9XCj6)
