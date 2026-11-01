# Football AI Analyst Pro

Mobile-friendly web app starter. It can be hosted on a free Node.js-compatible service (subject to that host's free-tier limits).

## Required setup
1. Create a free account with a hosting provider that supports Node.js apps.
2. Upload this project folder or connect its Git repository.
3. Add a server-side secret named `API_FOOTBALL_KEY` containing your API-Football key.
4. Deploy the app. Open its HTTPS URL in Chrome on Android.
5. In Chrome, use menu > Add to Home screen / Install app.

Do not put the API key in public HTML or JavaScript. The server reads it only from the hosting provider's secret/environment settings.

## Important limitations
- API-Football plan coverage, request limits, and available statistics vary by competition and subscription tier.
- Offside/foul averages are retrieved from available fixture statistics. If unavailable, the app displays “Unavailable”.
- The goal and match-outcome percentages are transparent baseline statistical estimates, not a validated predictive model or guarantees.
- This starter does not place bets, process payments, or promise accuracy.
- No hosting service or football data provider is guaranteed to remain free; check current terms and quotas.
