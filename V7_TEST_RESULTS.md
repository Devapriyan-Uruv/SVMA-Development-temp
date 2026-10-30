# V7 Test Results

- `node scripts/validate-v7.mjs`: **19/19 controls passed**.
- Deterministic target parser unit checks: **15/15 passed**, including strict `>100`, strict `<12`, exact `65`, range `55-75`, signed range `-2 mm - +4 mm`, CLOSED/OPEN and AUTHORISED/UNAUTHORISED.
- Full `npm ci -> npm run typecheck -> npm run build` could not be executed in this container because project dependencies are not installed and external npm access is unavailable. Run the commands below on the deployment Mac/CI before production deployment.

```bash
npm ci
npm run validate:v6
npm run validate:v7
npm run typecheck
npm run build
```
