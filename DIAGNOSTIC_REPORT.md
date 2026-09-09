# Queue Size Discrepancy - Diagnostic Report

## Report Date
2026-09-09

## Issue Summary
User reported that Davit sees 36 listings while Luis sees 11 listings in the queue. Investigation was conducted to determine if this is a bug.

## Findings

### System State Verification
✅ **Profile Configuration**: Both users have correctly configured profiles
- Davit: person="davit", email=davit.ierusalimski@gmail.com
- Luis: person="luis", email=luisgerardo.mtz@gmail.com

✅ **Preferences**: Couple preferences are properly stored and accessible
- Areas: Rivierenbuurt, Oud-West (Overtoom)
- Minimum size: 75m²
- Floor: ground level
- Energy: AB
- Outdoor: must have
- Ownership: freehold only
- Min bedrooms: 2
- Priority: location

✅ **Affinity Scoring**: Both explicit (preference-based) and learned (vote-based) profiles are correctly computed
- Davit's learned profile: 6 liked listings
- Luis's learned profile: 10 liked listings

### Vote Analysis
Total votes in database:
- Davit: 36 votes total (34 on available listings, 2 on hidden)
- Luis: 61 votes total (59 on available listings, 2 on hidden)

### Queue Calculation (Verified Correct)
Available listings: 70 (out of 81 total)
Hidden listings: 11 (sold, withdrawn, rented, sold subject to conditions)

**Davit's queue size:**
- Formula: Available listings - Votes on available
- Calculation: 70 - 34 = **36** ✓ Matches user report

**Luis's queue size:**
- Formula: Available listings - Votes on available
- Calculation: 70 - 59 = **11** ✓ Matches user report

## Conclusion

**No bug found.** The reported discrepancy is mathematically correct and due to different voting behavior:
- Davit has voted on 34 available listings
- Luis has voted on 59 available listings
- The difference explains why Luis has fewer listings remaining to view

Both users' systems are functioning correctly:
1. Authentication and profile creation ✓
2. Email-to-person mapping ✓
3. Preference storage and retrieval ✓
4. Vote recording and tracking ✓
5. Queue filtering and calculation ✓
6. Affinity scoring (explicit + learned) ✓

## Recommendation

The system is working as designed. The queue size difference reflects the users' different levels of engagement with the app, not a system malfunction.
